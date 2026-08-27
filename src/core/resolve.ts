import type { HatchFile, Hunk } from './ast.ts';
import type { LanguageAdapter, SourceMap } from '../lang/source-map.ts';
import type { Edit } from './patcher.ts';
import { matchPattern } from './matcher.ts';
import { planEdit, applyEdit } from './patcher.ts';
import { AmbiguityError, MatchError } from './errors.ts';

// Where a hunk lands, in the two coordinate systems a caller can actually use: the
// baseline as it sits on disk, and the text with every hunk applied. Neither is the
// system the matcher works in — hunk k is matched against the file where hunks
// 1..k-1 are ALREADY applied (see applyAll), so its raw position belongs to a stage
// that exists nowhere on screen. Projecting it back and forth is this module's whole
// job, and it lives next to the patcher so the rules of a splice are stated once.

export interface Span {
  readonly start: number;
  readonly end: number;
}

export type LinkStatus = 'ok' | 'no-match' | 'ambiguous' | 'error';

export interface LinkFailure {
  readonly kind: string;
  readonly message: string;
  /** line in the .md of the anchor that did not fit — where a squiggle belongs */
  readonly mdLine?: number;
  readonly failedStepIndex?: number;
  readonly totalSteps?: number;
  /** how far into the source the matcher got before giving up (baseline-stage coords) */
  readonly origPos?: number;
  readonly anchorText?: string;
  /** for an ambiguous pattern: every place it fits, in source coordinates */
  readonly candidates?: readonly number[];
}

export interface HunkLink {
  readonly index: number;
  readonly status: LinkStatus;
  /** lines this hunk occupies in the .md, from `# match` to the closing `# end` */
  readonly mdSpan?: readonly [number, number];
  /** what the hunk REPLACES, in baseline coordinates (start === end for an insertion) */
  readonly base?: Span;
  /** what the hunk WRITES, in the coordinates of the fully applied text */
  readonly final?: Span;
  readonly finalText?: string;
  /**
   * The pattern does not fit the pristine baseline and only resolves once earlier
   * hunks are in. Such a hunk has no place of its own in the baseline: `base` is the
   * point where the earlier hunk inserts, not text this hunk could replace.
   */
  readonly dependsOnEarlier: boolean;
  readonly failure?: LinkFailure;
}

export interface ResolveResult {
  readonly links: readonly HunkLink[];
  /** the baseline with every hunk that resolved applied; failed hunks are skipped */
  readonly applied: string;
}

/**
 * Resolve every hunk of a file against a baseline. Unlike applyAll, a hunk that does
 * not fit does not end the run: the editor needs a per-hunk verdict, and a broken
 * anchor in hunk 2 says nothing about hunk 1.
 */
export function resolveHunks(baseline: string, file: HatchFile, adapter: LanguageAdapter): ResolveResult {
  const baselineMap = adapter.buildMap(baseline);
  const staged: (Edit | null)[] = [];
  const drafts: Draft[] = [];
  let current = baseline;

  for (const [index, hunk] of file.hunks.entries()) {
    const untouched = current === baseline;
    const map = untouched ? baselineMap : adapter.buildMap(current);
    try {
      const edit = planEdit(matchPattern(hunk.match, map, adapter.normalize), map, hunk.patch);
      drafts.push({
        index,
        hunk,
        edit,
        dependsOnEarlier: untouched ? false : !fitsBaseline(hunk, baselineMap, adapter),
      });
      staged.push(edit);
      current = applyEdit(current, edit);
    } catch (e) {
      drafts.push({ index, hunk, edit: null, dependsOnEarlier: false, failure: describe(e, hunk) });
      staged.push(null);
    }
  }

  return { links: drafts.map((d) => project(d, staged, current)), applied: current };
}

interface Draft {
  readonly index: number;
  readonly hunk: Hunk;
  readonly edit: Edit | null;
  readonly dependsOnEarlier: boolean;
  readonly failure?: LinkFailure;
}

function project(draft: Draft, staged: readonly (Edit | null)[], applied: string): HunkLink {
  const mdSpan = draft.hunk.mdSpan;
  if (draft.edit === null) {
    const failure = draft.failure;
    return {
      index: draft.index,
      status: failure === undefined ? 'error' : statusOf(failure.kind),
      dependsOnEarlier: false,
      ...(mdSpan !== undefined ? { mdSpan } : {}),
      ...(failure !== undefined ? { failure } : {}),
    };
  }

  // back to the baseline: undo every edit that went in before this one
  let baseStart = draft.edit.start;
  let baseEnd = draft.edit.end;
  for (let j = draft.index - 1; j >= 0; j--) {
    const earlier = staged[j];
    if (earlier === null || earlier === undefined) continue;
    baseStart = backThrough(baseStart, earlier);
    baseEnd = backThrough(baseEnd, earlier);
  }

  // forward to the applied text: carry the written range through every later edit
  let finalStart = draft.edit.start;
  let finalEnd = draft.edit.start + draft.edit.text.length;
  for (let j = draft.index + 1; j < staged.length; j++) {
    const later = staged[j];
    if (later === null || later === undefined) continue;
    finalStart = forwardThrough(finalStart, later);
    finalEnd = forwardThrough(finalEnd, later);
  }

  return {
    index: draft.index,
    status: 'ok',
    dependsOnEarlier: draft.dependsOnEarlier,
    base: { start: baseStart, end: baseEnd },
    final: { start: finalStart, end: finalEnd },
    finalText: applied.slice(finalStart, finalEnd),
    ...(mdSpan !== undefined ? { mdSpan } : {}),
  };
}

/** a position in the text AFTER `edit`, expressed in the text before it */
function backThrough(pos: number, edit: Edit): number {
  if (pos <= edit.start) return pos;
  const writtenEnd = edit.start + edit.text.length;
  if (pos >= writtenEnd) return pos - edit.text.length + (edit.end - edit.start);
  return edit.start; // inside what the edit wrote — the baseline has no such place
}

/** a position in the text BEFORE `edit`, expressed in the text after it */
function forwardThrough(pos: number, edit: Edit): number {
  if (pos <= edit.start) return pos;
  if (pos >= edit.end) return pos + edit.text.length - (edit.end - edit.start);
  return edit.start; // inside what the edit replaced — that text is gone
}

function fitsBaseline(hunk: Hunk, baselineMap: SourceMap, adapter: LanguageAdapter): boolean {
  try {
    matchPattern(hunk.match, baselineMap, adapter.normalize);
    return true;
  } catch {
    return false;
  }
}

function statusOf(kind: string): LinkStatus {
  if (kind === 'MatchError') return 'no-match';
  if (kind === 'AmbiguityError') return 'ambiguous';
  return 'error';
}

function describe(e: unknown, hunk: Hunk): LinkFailure {
  const message = e instanceof Error ? e.message : String(e);

  if (e instanceof MatchError) {
    const mdLine = anchorLine(hunk, e.failedStepIndex);
    return {
      kind: 'MatchError',
      message,
      failedStepIndex: e.failedStepIndex,
      ...(mdLine !== undefined ? { mdLine } : {}),
      ...(e.totalSteps !== undefined ? { totalSteps: e.totalSteps } : {}),
      ...(e.origPos !== undefined ? { origPos: e.origPos } : {}),
      ...(e.anchorText !== undefined ? { anchorText: e.anchorText } : {}),
    };
  }

  if (e instanceof AmbiguityError) {
    // already in source coordinates: the matcher converts before it throws
    return { kind: 'AmbiguityError', message, candidates: e.positions };
  }

  return { kind: e instanceof Error ? e.name : 'Error', message };
}

function anchorLine(hunk: Hunk, stepIndex: number): number | undefined {
  const step = hunk.match.steps[stepIndex];
  if (step === undefined || step.anchor.target !== 'literal') return undefined;
  return step.anchor.literal.mdSpan[0];
}
