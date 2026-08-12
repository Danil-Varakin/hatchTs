import type { MatchPattern, Step, Gap, Anchor, Hunk } from '../core/ast.ts';
import type { LanguageAdapter, SourceMap, BlockSpan } from '../lang/source-map.ts';
import { matchPattern } from '../core/matcher.ts';
import { patchHunk } from '../core/patcher.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { AmbiguityError, MatchError } from '../core/errors.ts';
import { changeSegments } from './diff.ts';
import type { ChangeSegment } from './diff.ts';

export type SynthEvent =
  | { kind: 'segment'; index: number; seg: ChangeSegment }
  | { kind: 'attempt'; pattern: MatchPattern; result: 'unique' | 'ambiguous' | 'no-match'; matches: number }
  | { kind: 'hunk'; pattern: MatchPattern; patch: string };
export type Tracer = (event: SynthEvent) => void;

export interface SynthLimits {
  readonly minParents: number;
  readonly maxParents: number | 'all';
  readonly parentDetailBase: number;
  readonly parentDetailLimit: number;
  readonly minSiblings: number;
  readonly maxSiblings: number;
  readonly siblingDetailBase: number;
  readonly siblingDetailLimit: number;
  readonly parentsRequired: boolean;
}

export const DEFAULT_SYNTH_LIMITS: SynthLimits = {
  minParents: 1,
  maxParents: 'all',
  parentDetailBase: 0,
  parentDetailLimit: 2,
  minSiblings: 1,
  maxSiblings: 3,
  siblingDetailBase: 0,
  siblingDetailLimit: 2,
  parentsRequired: false,
} as const;

export type PartialLimits = { [K in keyof SynthLimits]?: SynthLimits[K] | undefined };

export function resolveLimits(patch: PartialLimits | undefined): SynthLimits {
  const out = { ...DEFAULT_SYNTH_LIMITS };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return Object.freeze(out);
}

export interface SynthOptions {
  bridgeGap?: number;
  exact?: boolean;
  trace?: Tracer | undefined;
  limits?: PartialLimits | undefined;
}

type MatchMarks = ReturnType<typeof matchPattern>;

interface HunkContext {
  readonly segment: ChangeSegment;
  readonly adapter: LanguageAdapter;
  readonly source: string; 
  readonly map: SourceMap;
  readonly lines: string[];
  readonly lineStartOffsets: number[];
  readonly lineCount: number;
  readonly firstChangedRowIndex: number; 
  readonly rowIndexAfterChange: number; 
  readonly changeStartOffset: number; 
  readonly changeEndOffset: number; 
  readonly canonStart: number;
  readonly canonEnd: number;
  readonly parents: readonly BlockSpan[]; 
  readonly intendedSource: string; 
  readonly normalizedIntendedLines: readonly string[]; 
  readonly requireExact: boolean; 
  readonly limits: SynthLimits; 
  readonly trace: Tracer | undefined;
}

interface ResolvedHunk {
  readonly pattern: MatchPattern;
  readonly patch: string;
  readonly appliedSource: string;
}

export function synthesize(
  oldSource: string,
  newSource: string,
  adapter: LanguageAdapter,
  options: SynthOptions = {},
): Hunk[] {
  const { bridgeGap = 0, exact = false, trace } = options;
  const limits = resolveLimits(options.limits);
  const segments = changeSegments(oldSource, newSource, bridgeGap);
  const hunks: Hunk[] = [];

  let currentSource = oldSource;
  let rowShift = 0; 

  for (const [index, originalSegment] of segments.entries()) {
    trace?.({ kind: 'segment', index, seg: originalSegment });
    const segment: ChangeSegment = { ...originalSegment, oldStart: originalSegment.oldStart + rowShift };

    const context = makeHunkContext(segment, currentSource, adapter, newSource.endsWith('\n'), exact, limits, trace);
    const resolved = resolveHunk(context);

    hunks.push({ match: resolved.pattern, patch: resolved.patch });
    currentSource = resolved.appliedSource;
    rowShift += segment.added.length - segment.removed.length;
  }

  const reproduced = exact
    ? currentSource === newSource
    : sameByLines(normalizedLines(currentSource, adapter), normalizedLines(newSource, adapter));
  if (!reproduced) {
    throw new Error(
      `synth: result differs from new (${hunks.length} hunk(s), ${exact ? 'verbatim' : 'normalized'} check)`,
    );
  }
  return hunks;
}

function makeHunkContext(
  segment: ChangeSegment,
  source: string,
  adapter: LanguageAdapter,
  newEndsWithNewline: boolean,
  requireExact: boolean,
  limits: SynthLimits,
  trace: Tracer | undefined,
): HunkContext {
  const lineStartOffsets = getLineStartOffsets(source);
  const lineCount = lineStartOffsets.length - 1;
  const firstChangedRowIndex = segment.oldStart - 1;
  const rowIndexAfterChange = firstChangedRowIndex + segment.removed.length;
  if (firstChangedRowIndex < 0 || rowIndexAfterChange > lineCount) {
    throw new Error(
      `synth: segment outside the file (oldStart=${segment.oldStart}, removed=${segment.removed.length}, lines=${lineCount})`,
    );
  }
  const changeStartOffset = lineStartOffsets[firstChangedRowIndex]!;
  const changeEndOffset = lineStartOffsets[rowIndexAfterChange]!;
  const map = adapter.buildMap(source);
  const canonStart = map.toCanonPos(changeStartOffset);
  const canonEnd = map.toCanonPos(changeEndOffset);

  const endsFile = changeEndOffset === source.length;
  const terminator = endsFile && !newEndsWithNewline ? '' : '\n';
  const addedBlock = segment.added.length > 0 ? segment.added.join('\n') + terminator : '';
  const intendedSource = source.slice(0, changeStartOffset) + addedBlock + source.slice(changeEndOffset);

  return {
    segment,
    adapter,
    source,
    map,
    lines: source.split('\n'),
    lineStartOffsets,
    lineCount,
    firstChangedRowIndex,
    rowIndexAfterChange,
    changeStartOffset,
    changeEndOffset,
    canonStart,
    canonEnd,
    parents: map
      .enclosing(canonStart)
      .filter((span) => span.headerStart !== undefined && span.close >= canonEnd),
    intendedSource,
    normalizedIntendedLines: normalizedLines(intendedSource, adapter),
    requireExact,
    limits,
    trace,
  };
}

// ── candidates ───────────────────────────────────────────────────────────────────
function resolveHunk(context: HunkContext): ResolvedHunk {
  let fallback: ResolvedHunk | undefined;
  let lastFailure: unknown;
  const tried = new Set<string>();

  for (const pattern of candidatePatterns(context)) {
    const signature = printPattern(pattern);
    if (tried.has(signature)) continue; 
    tried.add(signature);

    const attempt = verifyPattern(context, pattern);
    if ('failure' in attempt) {
      lastFailure = attempt.failure;
      continue;
    }
    if (attempt.exact || !context.requireExact) {
      context.trace?.({ kind: 'hunk', pattern, patch: attempt.hunk.patch });
      return attempt.hunk;
    }
    fallback ??= attempt.hunk;
  }

  if (fallback !== undefined) {
    context.trace?.({ kind: 'hunk', pattern: fallback.pattern, patch: fallback.patch });
    return fallback;
  }
  throw lastFailure ?? new AmbiguityError('synth: could not anchor the change with available context', []);
}

type Attempt = { hunk: ResolvedHunk; exact: boolean } | { failure: unknown };

function verifyPattern(context: HunkContext, pattern: MatchPattern): Attempt {
  const { map, adapter, source, trace } = context;
  let marks: MatchMarks;
  try {
    marks = matchPattern(pattern, map, adapter.normalize);
  } catch (error) {
    if (error instanceof MatchError) {
      trace?.({ kind: 'attempt', pattern, result: 'no-match', matches: 0 });
      return { failure: error };
    }
    if (error instanceof AmbiguityError) {
      trace?.({ kind: 'attempt', pattern, result: 'ambiguous', matches: error.positions.length });
      return { failure: error };
    }
    throw error;
  }
  trace?.({ kind: 'attempt', pattern, result: 'unique', matches: 1 });

  const cut = computeCutRange(marks, map);
  const patch = extractReplacementText(context.intendedSource, source, cut.startOffset, cut.endOffset);
  const appliedSource = patchHunk(source, map, marks, patch).source;
  if (appliedSource === context.intendedSource) {
    return { hunk: { pattern, patch, appliedSource }, exact: true };
  }
  if (!sameByLines(normalizedLines(appliedSource, adapter), context.normalizedIntendedLines)) {
    return { failure: new MatchError('anchor matched but did not reproduce the change', cut.startOffset, 0) };
  }
  return { hunk: { pattern, patch, appliedSource }, exact: false };
}

function normalizedLines(text: string, adapter: LanguageAdapter): string[] {
  return text.split('\n').map((line) => adapter.normalize(line));
}

function sameByLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function computeCutRange(marks: MatchMarks, map: SourceMap): { startOffset: number; endOffset: number } {
  const startOffset = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  const endOffset = marks.replaceEnd === undefined ? startOffset : map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  return { startOffset, endOffset };
}

function extractReplacementText(intendedSource: string, source: string, startOffset: number, endOffset: number): string {
  const suffixLength = source.length - endOffset;
  return intendedSource.slice(startOffset, intendedSource.length - suffixLength);
}

// ── candidate ladder ─────────────────────────────────────────────────────────────

function* candidatePatterns(context: HunkContext): Generator<MatchPattern> {
  for (const cut of cutForms(context)) yield* contextLadder(context, cut);
}

function* contextLadder(context: HunkContext, cut: Cut): Generator<MatchPattern> {
  const {
    minParents,
    maxParents,
    parentDetailBase,
    parentDetailLimit,
    minSiblings,
    maxSiblings,
    siblingDetailBase,
    siblingDetailLimit,
    parentsRequired,
  } = context.limits;

  const available = context.parents.length;
  const topParents = maxParents === 'all' ? available : Math.min(maxParents, available);
  const baseParents = Math.min(minParents, topParents);
  const baseAbove = Math.min(minSiblings, maxSiblings);

  for (let parents = baseParents; parents <= topParents; parents++) {
    yield* patternFor(context, cut, parents, parentDetailBase, siblingDetailBase, baseAbove, 0);
  }
  for (let level = parentDetailBase + 1; level <= parentDetailLimit; level++) {
    yield* patternFor(context, cut, topParents, level, siblingDetailBase, baseAbove, 0);
  }
  for (let level = siblingDetailBase + 1; level <= siblingDetailLimit; level++) {
    yield* patternFor(context, cut, topParents, parentDetailLimit, level, baseAbove, 0);
  }
  for (let distance = 1; distance <= 2 * maxSiblings - baseAbove; distance++) {
    for (let extraAbove = 0; extraAbove <= Math.min(distance, maxSiblings - baseAbove); extraAbove++) {
      const below = distance - extraAbove;
      if (below > maxSiblings) continue;
      yield* patternFor(context, cut, topParents, parentDetailBase, siblingDetailBase, baseAbove + extraAbove, below);
    }
  }
  if (baseParents > 0 && !parentsRequired) {
    yield* patternFor(context, cut, 0, parentDetailBase, siblingDetailBase, baseAbove, 0);
  }
}

function* patternFor(
  context: HunkContext,
  cut: Cut,
  parentCount: number,
  parentDetail: number,
  siblingDetail: number,
  aboveRows: number,
  belowRows: number,
): Generator<MatchPattern> {
  const minBelow = cut.pinsRight ? Math.min(context.limits.minSiblings, context.limits.maxSiblings) : 0;
  const lead = buildLead(context, parentCount, parentDetail, siblingDetail, cut.needsAbove ? aboveRows : 0);
  const tail = buildTail(context, parentCount, siblingDetail, Math.max(belowRows, minBelow));
  const pattern = assemblePattern(context, lead, cut, tail);
  if (pattern !== null) yield pattern;
}

// ── cut forms ────────────────────────────────────────────────────────────────────
type Cut =
  | { kind: 'insert'; side: 'left' | 'right'; needsAbove: boolean; pinsRight: boolean; allowEdge: boolean }
  | { kind: 'exact'; needsAbove: false; pinsRight: false; allowEdge: boolean }
  | { kind: 'context'; needsAbove: true; pinsRight: true; allowEdge: boolean }
  | { kind: 'contextBelow'; needsAbove: false; pinsRight: true; allowEdge: boolean }
  | { kind: 'contextAbove'; needsAbove: true; pinsRight: false; allowEdge: boolean }
  | { kind: 'span'; needsAbove: true; pinsRight: true; allowEdge: boolean };

function* cutForms(context: HunkContext): Generator<Cut> {
  const { segment, map, parents, canonStart, canonEnd } = context;

  if (segment.removed.length === 0) {
    const atBlockEnd = parents.length > 0 && canonStart === parents[0]!.close;
    const atFileEnd = canonStart === map.eof;
    const toLeft: Cut = { kind: 'insert', side: 'left', needsAbove: true, pinsRight: false, allowEdge: true };
    const toRight: Cut = { kind: 'insert', side: 'right', needsAbove: false, pinsRight: true, allowEdge: true };
    if (atBlockEnd || atFileEnd) yield* [toRight, toLeft];
    else yield* [toLeft, toRight];
    yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
    return;
  }

  if (canonStart === 0 && canonEnd === map.eof) {
    yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
  }
  if (segment.added.length > 0 && preservesBoundaryWhitespace(segment.removed, segment.added)) {
    yield { kind: 'exact', needsAbove: false, pinsRight: false, allowEdge: false };
  }
  yield { kind: 'context', needsAbove: true, pinsRight: true, allowEdge: false };
  yield { kind: 'contextBelow', needsAbove: false, pinsRight: true, allowEdge: false };
  yield { kind: 'contextAbove', needsAbove: true, pinsRight: false, allowEdge: false };
  yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: false };
  yield { kind: 'context', needsAbove: true, pinsRight: true, allowEdge: true };
  yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
}

function assemblePattern(context: HunkContext, lead: Step[], cut: Cut, tail: Tail): MatchPattern | null {
  const [first, ...rest] = tail.steps;
  const head = first!;

  const hasLeft = lead.length > 0 || (cut.allowEdge && context.canonStart === 0);
  const hasRight =
    tail.startCanon === context.canonEnd && (cut.allowEdge || head.anchor.target === 'literal');
  if (cut.needsAbove && !hasLeft) return null;
  if (cut.pinsRight && !hasRight) return null;

  const removedAnchor = (): Anchor | null =>
    literalAnchor(context, context.segment.removed.join('\n'));
  const fromRemoved = (anchor: Anchor): Step => ({ gap: markedGap(skipGap(), ['insert', 'right']), anchor });
  const afterLead = (anchor: Anchor): Step => ({ gap: markedGap(tightGap(), ['insert', 'left']), anchor });

  switch (cut.kind) {
    case 'insert':
      return pattern(context, lead, [withMarks(head, ['insert', cut.side]), ...rest]);

    case 'exact': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [fromRemoved(removed), withMarks(head, ['replaceEnd', 'left']), ...rest]);
    }
    case 'context': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [afterLead(removed), withMarks(head, ['replaceEnd', 'right']), ...rest]);
    }
    case 'contextBelow': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [fromRemoved(removed), withMarks(head, ['replaceEnd', 'right']), ...rest]);
    }
    case 'contextAbove': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [afterLead(removed), withMarks(head, ['replaceEnd', 'left']), ...rest]);
    }
    case 'span':
      return pattern(context, lead, [withMarks(head, ['insert', 'left'], ['replaceEnd', 'right']), ...rest]);
  }
}

function pattern(context: HunkContext, lead: Step[], rest: Step[]): MatchPattern {
  const steps = [...lead, ...rest];
  const head = steps[0]!;
  const tightenable =
    lead.length === 0 &&
    context.canonStart === 0 &&
    head.anchor.target === 'literal' &&
    head.gap.mode.op === 'skipAny' &&
    !hasRightMark(head.gap);
  if (tightenable) steps[0] = { gap: { ...head.gap, mode: { op: 'tight' } }, anchor: head.anchor };
  return { steps };
}

// ── lead and tail ────────────────────────────────────────────────────────────────
function buildLead(
  context: HunkContext,
  parentCount: number,
  parentDetail: number,
  siblingDetail: number,
  aboveRows: number,
): Step[] {
  const steps: Step[] = [];
  for (let i = parentCount - 1; i >= 0; i--) {
    steps.push(...headerSteps(context, context.parents[i]!, parentDetail));
  }
  steps.push(...neighbourStepsAbove(context, aboveRows, siblingDetail));
  return steps;
}

interface Tail {
  readonly steps: Step[];
  readonly startCanon: number;
}

function buildTail(context: HunkContext, parentCount: number, siblingDetail: number, belowRows: number): Tail {
  const steps: Step[] = [];
  let startCanon: number | null = null;

  if (belowRows > 0) {
    const below = neighbourStepsBelow(context, belowRows, siblingDetail);
    if (below.length > 0) {
      steps.push(...below);
      startCanon = context.canonEnd;
    }
  }
  for (let i = 0; i < parentCount; i++) {
    const closer = closerStep(context, context.parents[i]!);
    if (closer === null) break; 
    steps.push(closer);
    startCanon ??= context.parents[i]!.close;
  }
  steps.push(skipStep(EOF_ANCHOR));
  return { steps, startCanon: startCanon ?? context.map.eof };
}

function headerSteps(context: HunkContext, span: BlockSpan, detail: number): Step[] {
  const { map } = context;
  const from = map.toOriginalPos(span.headerStart ?? span.open, 'right');
  const to = map.toOriginalPos(span.open + 1, 'left');
  return stepsForRange(context, from, to, detail);
}

function closerStep(context: HunkContext, span: BlockSpan): Step | null {
  if (span.closeEnd === undefined) return null;
  const { map, source } = context;
  const raw = source.slice(map.toOriginalPos(span.close, 'right'), map.toOriginalPos(span.closeEnd, 'left'));
  const anchor = literalAnchor(context, raw);
  return anchor === null ? null : skipStep(anchor);
}

// ── neighbours ───────────────────────────────────────────────────────────────────
function neighbourStepsAbove(context: HunkContext, rows: number, detail: number): Step[] {
  const { parents, map, lines, lineStartOffsets, firstChangedRowIndex } = context;
  const limit = parents.length > 0 ? map.toOriginalPos(parents[0]!.open + 1, 'right') : 0;

  let row = firstChangedRowIndex;
  let taken = 0;
  while (row > 0 && taken < rows && lineStartOffsets[row - 1]! >= limit) {
    row--;
    if (!isBlankLine(lines[row])) taken++;
  }
  const from = taken < rows ? limit : Math.max(lineStartOffsets[row]!, limit);
  return stepsForRange(context, from, context.changeStartOffset, detail);
}

function neighbourStepsBelow(context: HunkContext, rows: number, detail: number): Step[] {
  const { parents, map, lines, lineStartOffsets, lineCount, rowIndexAfterChange } = context;
  const limit = parents.length > 0 ? map.toOriginalPos(parents[0]!.close, 'right') : context.source.length;

  let row = rowIndexAfterChange;
  let taken = 0;
  while (row < lineCount && taken < rows && lineStartOffsets[row]! < limit) {
    if (!isBlankLine(lines[row])) taken++;
    row++;
  }
  const to = Math.min(taken < rows ? limit : lineStartOffsets[row]!, limit);
  return stepsForRange(context, context.changeEndOffset, to, detail);
}

// ── generalized anchors ──────────────────────────────────────────────────────────
function stepsForRange(context: HunkContext, from: number, to: number, detail: number): Step[] {
  if (to <= from) return [];
  const { map } = context;
  const canonFrom = map.toCanonPos(from);
  const canonTo = map.toCanonPos(to);
  if (canonTo <= canonFrom) return [];

  const steps: Step[] = [];
  let cursor = canonFrom;
  for (const bracket of bracketsToGeneralize(map, canonFrom, canonTo, detail)) {
    appendLiteralSegment(context, steps, cursor, bracket.open + 1); 
    cursor = bracket.close; 
  }
  appendLiteralSegment(context, steps, cursor, canonTo);
  return steps;
}

function bracketsToGeneralize(map: SourceMap, canonFrom: number, canonTo: number, detail: number): BlockSpan[] {
  const out: BlockSpan[] = [];
  const open: number[] = []; 
  for (const span of map.blocksWithin(canonFrom, canonTo)) {
    while (open.length > 0 && open[open.length - 1]! <= span.open) open.pop();
    const depth = open.length;
    open.push(span.close);
    if (span.close <= span.open + 1) continue; 
    if (depth < detail) continue; 
    if (out.length > 0 && span.open < out[out.length - 1]!.close) continue; 
    out.push(span);
  }
  return out;
}

function appendLiteralSegment(context: HunkContext, steps: Step[], canonFrom: number, canonTo: number): void {
  if (canonTo <= canonFrom) return;
  const { source, map, lineStartOffsets } = context;
  let start = map.toOriginalPos(canonFrom, 'right');
  const end = map.toOriginalPos(canonTo, 'left');
  const lineStart = lineStartOffsets[findRowIndexAt(lineStartOffsets, start)]!;
  if (source.slice(lineStart, start).trim() === '') start = lineStart;

  const anchor = literalAnchor(context, source.slice(start, end));
  if (anchor !== null) steps.push(skipStep(anchor));
}

function literalAnchor(context: HunkContext, raw: string): Anchor | null {
  if (context.adapter.normalize(raw) === '') return null;
  return { target: 'literal', literal: { raw, mdSpan: [0, 0] } };
}

// ── lines and whitespace ─────────────────────────────────────────────────────────
function getLineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) offsets.push(i + 1);
  if (offsets[offsets.length - 1] !== text.length) offsets.push(text.length);
  return offsets;
}

function findRowIndexAt(lineStartOffsets: number[], offset: number): number {
  let lo = 0;
  let hi = lineStartOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStartOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function isBlankLine(line: string | undefined): boolean {
  return (line ?? '').trim() === '';
}

function preservesBoundaryWhitespace(removed: string[], added: string[]): boolean {
  return (
    added[0]!.startsWith(getLeadingWhitespace(removed[0]!)) &&
    getTrailingWhitespace(removed[removed.length - 1]!) === getTrailingWhitespace(added[added.length - 1]!)
  );
}

function getLeadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}
function getTrailingWhitespace(line: string): string {
  return /[ \t]*$/.exec(line)![0];
}

// ── step constructors ────────────────────────────────────────────────────────────
const EOF_ANCHOR: Anchor = { target: 'eof' };

type Mark = ['insert' | 'replaceEnd', 'left' | 'right'];

function skipGap(): Gap {
  return { mode: { op: 'skipAny' } };
}
function tightGap(): Gap {
  return { mode: { op: 'tight' } };
}
function markedGap(gap: Gap, ...marks: Mark[]): Gap {
  for (const [mark, side] of marks) gap[mark] = { side, mdLine: 0 };
  return gap;
}
function hasRightMark(gap: Gap): boolean {
  return gap.insert?.side === 'right' || gap.replaceEnd?.side === 'right';
}
function skipStep(anchor: Anchor): Step {
  return { gap: skipGap(), anchor };
}
function withMarks(step: Step, ...marks: Mark[]): Step {
  return { gap: markedGap({ mode: step.gap.mode }, ...marks), anchor: step.anchor };
}
