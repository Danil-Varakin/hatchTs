import type { MatchPattern, Gap, Literal } from './ast.ts';
import type { SourceMap } from '../lang/source-map.ts';
import { MatchError, AmbiguityError } from './errors.ts';

export interface LocatedMark {
  pos: number;
  side: 'left' | 'right';
}

export interface MatchMarks {
  insert: LocatedMark;
  replaceEnd?: LocatedMark;
}

interface Marks {
  insert?: LocatedMark;
  replaceEnd?: LocatedMark;
}

export function matchPattern(
  pattern: MatchPattern,
  map: SourceMap,
  normalize: (raw: string) => string,
): MatchMarks {
  const steps = pattern.steps;
  const eof = map.eof;

  const normCache = new Map<Literal, string>();
  const normOf = (lit: Literal): string => {
    let n = normCache.get(lit);
    if (n === undefined) {
      n = normalize(lit.raw);
      normCache.set(lit, n);
    }
    return n;
  };

  const edits = new Map<string, MatchMarks>();
  const spans = new Map<string, LocatedMark | undefined>();
  let stop = false; 
  let deepestPos = -1; 
  let deepestStep = 0;
  let deepestAnchor: string | undefined;
  let deepestMatched: Matched | null = null;
  const recordDeepest = (pos: number, i: number, anchor: string | undefined, last: Matched | null): void => {
    if (pos > deepestPos) {
      deepestPos = pos;
      deepestStep = i;
      deepestAnchor = anchor;
      deepestMatched = last;
    }
  };

  const advance = (norm: string, A: number, stack: readonly number[]): { pos: number; stack: number[] } => {
    const B = A + norm.length;
    const s = stack.slice();
    while (s.length > 0 && s[s.length - 1]! >= A && s[s.length - 1]! < B) s.pop();
    const entered = map.enclosing(B).filter((sp) => sp.open >= A);
    for (let k = entered.length - 1; k >= 0; k--) s.push(entered[k]!.close); 
    return { pos: B, stack: s };
  };

  const isCloser = (p: number, len: number): boolean =>
    map.enclosing(p).some((s) => s.close < p + len);

  const applySide = (marks: Marks, gap: Gap, side: 'left' | 'right', at: number): Marks => {
    let m = marks;
    if (gap.insert !== undefined && gap.insert.side === side) m = { ...m, insert: { pos: at, side } };
    if (gap.replaceEnd !== undefined && gap.replaceEnd.side === side) m = { ...m, replaceEnd: { pos: at, side } };
    return m;
  };

  const signature = (m: Marks): string =>
    `${m.insert?.pos ?? ''}:${m.insert?.side ?? ''}|${m.replaceEnd?.pos ?? ''}:${m.replaceEnd?.side ?? ''}`;

  const recordFull = (m: Marks): void => {
    const sig = signature(m);
    if (!edits.has(sig)) {
      edits.set(sig, m as MatchMarks); 
      spans.set(sig, m.replaceEnd);
      if (edits.size >= 2) stop = true;
    }
  };

  const walk = (i: number, pos: number, stack: number[], marks: Marks, last: Matched | null): boolean => {
    if (stop) return edits.size > 0;

    if (i === steps.length) {
      if (pos !== eof) {
        recordDeepest(pos, i, undefined, last);
        return false;
      }
      recordFull(marks);
      return true;
    }

    const { gap, anchor } = steps[i]!;
    const mL = applySide(marks, gap, 'left', pos); 

    if (anchor.target === 'eof') {
      if (gap.mode.op === 'skipAny') {
        const mR = applySide(mL, gap, 'right', eof);
        return walk(i + 1, eof, stack, mR, last);
      }
      return walk(i + 1, pos, stack, mL, last); 
    }

    const norm = normOf(anchor.literal);

    if (gap.mode.op === 'tight') {
      if (!map.matchesAt(norm, pos)) {
        recordDeepest(pos, i, anchor.literal.raw, last);
        return false;
      }
      const adv = advance(norm, pos, stack);
      return walk(i + 1, adv.pos, adv.stack, mL, { text: anchor.literal.raw, pos }); 
    }

    const W = stack.length > 0 ? stack[stack.length - 1]! : -1;
    const obligation = stack.length > 0 && W >= pos && map.matchesAt(norm, W);
    if (obligation) {
      const mR = applySide(mL, gap, 'right', W);
      const adv = advance(norm, W, stack);
      if (walk(i + 1, adv.pos, adv.stack, mR, { text: anchor.literal.raw, pos: W })) return true;
      if (stop) return edits.size > 0;
    }

    let found = false;
    let sawCandidate = false;
    for (const p of map.occurrences(norm, pos, eof)) {
      if (obligation && p === W) continue; 
      if (isCloser(p, norm.length) && stack.some((c) => c < p)) continue;
      sawCandidate = true;
      const mR = applySide(mL, gap, 'right', p);
      const adv = advance(norm, p, stack);
      if (walk(i + 1, adv.pos, adv.stack, mR, { text: anchor.literal.raw, pos: p })) found = true;
      if (stop) return edits.size > 0;
    }
    if (!found && !sawCandidate && !obligation) recordDeepest(pos, i, anchor.literal.raw, last);
    return found;
  };

  walk(0, 0, [], {}, null);

  if (edits.size === 0) throw noMatch();
  if (edits.size >= 2) {
    const positions = [...edits.values()].map((m) => map.toOriginalPos(m.insert.pos, m.insert.side));
    const ends = [...spans.values()].map((e) => (e === undefined ? undefined : map.toOriginalPos(e.pos, e.side)));
    throw new AmbiguityError(
      'ambiguous match: the pattern fits in more than one place — add context',
      positions,
      ends,
    );
  }
  return [...edits.values()][0]!;

  function noMatch(): MatchError {
    const ranPastEnd = deepestStep >= steps.length;
    const detail: {
      totalSteps: number;
      origPos?: number;
      anchorText?: string;
      matchedText?: string;
      matchedPos?: number;
      hint?: string;
    } = { totalSteps: steps.length, origPos: map.toOriginalPos(deepestPos < 0 ? 0 : deepestPos, 'right') };
    if (deepestAnchor !== undefined) detail.anchorText = deepestAnchor;
    const matched: Matched | null = deepestMatched;
    if (matched !== null) {
      detail.matchedText = matched.text;
      detail.matchedPos = map.toOriginalPos(matched.pos, 'right');
    }
    if (ranPastEnd) {
      detail.hint =
        'the pattern requires the file to END here: a match block that stops without a ' +
        'trailing `...` describes the file to its last character. Add `...` at the end.';
    }
    return new MatchError(
      ranPastEnd
        ? 'no match: the pattern ran out of steps while the file went on'
        : 'no match: the pattern did not fit the file',
      deepestPos < 0 ? 0 : deepestPos,
      deepestStep,
      detail,
    );
  }
}

interface Matched {
  readonly text: string;
  readonly pos: number;
}
