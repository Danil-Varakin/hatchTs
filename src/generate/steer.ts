import type { Hunk, MatchPattern, Step } from '../core/ast.ts';
import { AmbiguityError, MatchError } from '../core/errors.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import type { Span } from '../core/resolve.ts';
import { checkHeading } from '../lang/adapter.ts';
import type { LanguageAdapter, MapCache } from '../lang/source-map.ts';
import { InputClosed } from '../infra/ask.ts';
import { changeSegments } from './diff.ts';
import type { ChangeSegment } from './diff.ts';
import { printHatchFile } from './printer.ts';
import { getLineStartOffsets, sameIgnoringSpace, synthesizeOne } from './synth.ts';
import type { PartialLimits, Tracer } from './synth.ts';

// Synthesis a person steers, one change at a time — `generate -a`, and any `generate`
// with a terminal whose synthesis could not anchor a change.
//
// The state is nothing but the hunks so far. Each step replays them over the OLD version
// and takes the first change still between that text and the new one; so a hunk written
// by hand — pattern, patch body, anything — is simply the new state, and the next hunk is
// built against what it produced. What a hunk wrote is settled: a difference inside it is
// not offered again, which is how a patch body edited on purpose stays as it was edited.

/** What the person says about a hunk synthesis offers. */
export type Verdict =
  | 'keep'
  /** leave this change out of the .md; the next hunks are built without it */
  | 'skip'
  /** not this hunk — offered the editor next (`offerEdit`); refused, the run stops */
  | 'decline';

export interface Steering {
  /** Asked about every hunk synthesis offers; absent — every hunk is kept. `total` counts
   *  the hunks so far and the changes still to go. */
  readonly review?: ((hunk: Hunk, number: number, total: number) => Promise<Verdict>) | undefined;
  /** Asked after a declined hunk, a change synthesis could not anchor, or a hand edit
   *  that does not stand: go (back) to the editor? `false` stops the run, and nothing
   *  is written. `why` is the reason, to show. */
  readonly offerEdit: (why: string) => Promise<boolean>;
  /** The .md so far — a note on top — to the editor, and back as edited. */
  readonly edit: (text: string) => Promise<string>;
}

export interface SteerRequest {
  readonly oldText: string;
  readonly newText: string;
  readonly adapter: LanguageAdapter;
  /** the `# match` heading */
  readonly label: string;
  readonly bridgeGap: number;
  readonly exact: boolean;
  readonly limits?: PartialLimits | undefined;
  readonly trace?: Tracer | undefined;
  readonly maps?: MapCache | undefined;
}

export interface Steered {
  readonly hunks: readonly Hunk[];
  /** the hunks give the new version — false when changes were left out or edited */
  readonly reproducesNew: boolean;
}

export async function steerSynthesis(request: SteerRequest, steering: Steering): Promise<Steered> {
  const { oldText, newText, adapter, label, bridgeGap, exact, trace, maps } = request;
  let hunks: readonly Hunk[] = [];
  let target = newText;

  for (;;) {
    const { applied: current, links } = resolveHunks(oldText, { hunks: [...hunks], language: label }, adapter, maps);
    const settled = links.flatMap((l) => (l.final !== undefined ? [l.final] : []));
    const pending = changeSegments(current, target, bridgeGap).filter((s) => !touches(s, current, settled));
    if (pending.length === 0) {
      return { hunks, reproducesNew: exact ? current === newText : sameIgnoringSpace(current, newText, adapter) };
    }

    const segment = pending[0]!;
    const number = hunks.length + 1;
    const total = hunks.length + pending.length;
    trace?.({ kind: 'segment', index: hunks.length, total, seg: segment });

    let candidate: Hunk;
    try {
      candidate = synthesizeOne(segment, current, target, adapter, { bridgeGap, exact, limits: request.limits, trace, maps });
    } catch (e) {
      if (!(e instanceof MatchError || e instanceof AmbiguityError)) throw e;
      const why = `hunk ${number}: the change at line ${segment.oldStart} could not be anchored — ${firstLine(e)}`;
      if (!(await steering.offerEdit(why))) throw e;
      hunks = await editUntilItStands([...hunks, template(segment, current)], why, segment, request, steering);
      continue;
    }

    const verdict = await verdictOn(candidate, number, total, steering);
    if (verdict === 'keep') {
      hunks = [...hunks, candidate];
    } else if (verdict === 'skip') {
      target = leftOut(segment, current, target);
    } else {
      const why = `hunk ${number}: declined`;
      if (!(await steering.offerEdit(why))) throw new Error(`${why} — nothing was written`);
      hunks = await editUntilItStands([...hunks, candidate], why, segment, request, steering);
    }
  }
}

async function verdictOn(hunk: Hunk, number: number, total: number, steering: Steering): Promise<Verdict> {
  if (steering.review === undefined) return 'keep';
  try {
    return await steering.review(hunk, number, total);
  } catch (e) {
    if (!(e instanceof InputClosed)) throw e;
    throw new Error(
      `-a: the input closed at hunk ${number} of ${total}, before it was answered — nothing was written\n` +
        '  answer every hunk (one line each, Enter keeps it), or drop -a',
    );
  }
}

// ── the editor round trip ────────────────────────────────────────────────────────

/** The .md goes to the editor until what comes back parses and every hunk of it lands on
 *  the old version, in order. Each time it does not, the reason goes on top and the
 *  person is asked again; saying no stops the run. */
async function editUntilItStands(
  hunks: readonly Hunk[],
  why: string,
  segment: ChangeSegment,
  request: SteerRequest,
  steering: Steering,
): Promise<readonly Hunk[]> {
  let body = printHatchFile(hunks, request.label);
  let reason = why;
  for (;;) {
    const edited = await steering.edit(`${note(reason, segment)}${body}`);
    const checked = check(edited, request);
    if (typeof checked !== 'string') return checked;
    if (!(await steering.offerEdit(checked))) throw new Error(`${checked}\n  nothing was written`);
    reason = checked;
    body = bodyOf(edited);
  }
}

/** The hunks the edited text holds, or the reason it does not stand. */
function check(text: string, request: SteerRequest): readonly Hunk[] | string {
  let file;
  try {
    file = parseHatchFile(text);
  } catch (e) {
    return `the edited .md does not parse: ${firstLine(e)}`;
  }
  if (file.language !== undefined) {
    try {
      checkHeading(file.language, request.adapter);
    } catch (e) {
      return firstLine(e);
    }
  }
  const { links } = resolveHunks(request.oldText, file, request.adapter, request.maps);
  const bad = links.find((l) => l.status !== 'ok');
  if (bad === undefined) return file.hunks;
  const at = bad.failure?.mdLine ?? bad.mdSpan?.[0];
  return `hunk ${bad.index + 1}${at !== undefined ? ` (line ${at})` : ''} does not land: ${bad.failure?.message ?? bad.status}`;
}

const NOTE_WIDTH = 80;

/** Prose above the first `# match`, which the parser skips. No line of it starts at
 *  column 0 with `#`, so a quoted line of code can never pass for a heading. */
function note(reason: string, segment: ChangeSegment): string {
  const quote = (lines: readonly string[], mark: string): string[] => lines.map((l) => `  ${mark} ${l}`);
  return [
    'Hatch — edit the hunks below, then save and close the editor. The hunks are applied',
    'in order to the OLD version, and everything above the first "# match" is ignored.',
    '',
    ...reason.split('\n').map((l) => `  ${l}`),
    '',
    `The change this is about (line ${segment.oldStart} of the text so far):`,
    ...quote(segment.removed, '-'),
    ...quote(segment.added, '+'),
    '',
    '-'.repeat(NOTE_WIDTH),
    '',
  ].join('\n');
}

function bodyOf(edited: string): string {
  const at = edited.search(/^#{1,6}[ \t]*match\b/im);
  return at === -1 ? edited : edited.slice(at);
}

// ── a hunk to start from when synthesis found none ───────────────────────────────

const CONTEXT_LINES = 3;

/** The change with the lines just above it for context — the classic diff hunk, in the
 *  pattern language. Synthesis failed on it, so it is most likely ambiguous as it
 *  stands: a place to start editing, not an answer. Blank lines are left out of the
 *  context: the canon drops them, and a literal cannot be made of them. */
function template(segment: ChangeSegment, current: string): Hunk {
  const lines = current.split('\n');
  const above: string[] = [];
  for (let k = segment.oldStart - 2; k >= 0 && above.length < CONTEXT_LINES; k--) {
    if (lines[k]!.trim() !== '') above.unshift(lines[k]!);
  }
  const context = above.join('\n');
  const removed = segment.removed.join('\n');
  const added = segment.added.join('\n');
  const left = { side: 'left' as const, mdLine: 0 };
  const right = { side: 'right' as const, mdLine: 0 };
  const eof = { target: 'eof' as const };

  // `... context >>> removed <<< ...`, the patch taking up after the context's last
  // character; with no context, `... >>> removed <<< ...` or, for a bare insertion,
  // `>>> ...` at the top of the file.
  const steps: Step[] = [];
  let patch: string;
  if (context !== '') {
    steps.push({ gap: { mode: { op: 'skipAny' } }, anchor: literal(context) });
    if (removed !== '') {
      steps.push({ gap: { mode: { op: 'tight' }, insert: left }, anchor: literal(removed) });
      steps.push({ gap: { mode: { op: 'skipAny' }, replaceEnd: left }, anchor: eof });
    } else {
      steps.push({ gap: { mode: { op: 'skipAny' }, insert: left }, anchor: eof });
    }
    patch = added === '' ? '' : `\n${added}`;
  } else if (removed !== '') {
    steps.push({ gap: { mode: { op: 'skipAny' }, insert: right }, anchor: literal(removed) });
    steps.push({ gap: { mode: { op: 'skipAny' }, replaceEnd: left }, anchor: eof });
    patch = added;
  } else {
    steps.push({ gap: { mode: { op: 'skipAny' }, insert: left }, anchor: eof });
    patch = `${added}\n`;
  }
  const match: MatchPattern = { steps };
  return { match, patch };
}

function literal(raw: string): Step['anchor'] {
  return { target: 'literal', literal: { raw, mdSpan: [0, 0] } };
}

// ── what is left to do ───────────────────────────────────────────────────────────

/** Whether a change lies in text a hunk already wrote. */
function touches(segment: ChangeSegment, current: string, settled: readonly Span[]): boolean {
  const offsets = getLineStartOffsets(current);
  const lineAt = (k: number): number => offsets[Math.min(k, offsets.length - 1)]!;
  const start = lineAt(segment.oldStart - 1);
  const end = lineAt(segment.oldStart - 1 + segment.removed.length);
  return settled.some((s) =>
    start < end ? start < s.end && s.start < end : s.start < start && start < s.end,
  );
}

/** The target with one change taken back: its lines as the current text has them. */
function leftOut(segment: ChangeSegment, current: string, target: string): string {
  const lines = target.split('\n');
  lines.splice(segment.newStart - 1, segment.added.length, ...segment.removed);
  return lines.join('\n');
}

function firstLine(e: unknown): string {
  return String(e instanceof Error ? e.message : e).split('\n')[0] ?? '';
}
