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
  let stop = false; 
  let deepestPos = -1; 
  let deepestStep = 0;
  const recordDeepest = (pos: number, i: number): void => {
    if (pos > deepestPos) {
      deepestPos = pos;
      deepestStep = i;
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
      if (edits.size >= 2) stop = true;
    }
  };

  const walk = (i: number, pos: number, stack: number[], marks: Marks): boolean => {
    if (stop) return edits.size > 0;

    if (i === steps.length) {
      if (pos !== eof) {
        recordDeepest(pos, i);
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
        return walk(i + 1, eof, stack, mR);
      }
      return walk(i + 1, pos, stack, mL); 
    }

    const norm = normOf(anchor.literal);

    if (gap.mode.op === 'tight') {
      if (!map.matchesAt(norm, pos)) {
        recordDeepest(pos, i);
        return false;
      }
      const adv = advance(norm, pos, stack);
      return walk(i + 1, adv.pos, adv.stack, mL); 
    }

    const W = stack.length > 0 ? stack[stack.length - 1]! : -1;
    const obligation = stack.length > 0 && W >= pos && map.matchesAt(norm, W);
    if (obligation) {
      const mR = applySide(mL, gap, 'right', W);
      const adv = advance(norm, W, stack);
      if (walk(i + 1, adv.pos, adv.stack, mR)) return true;
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
      if (walk(i + 1, adv.pos, adv.stack, mR)) found = true;
      if (stop) return edits.size > 0;
    }
    if (!found && !sawCandidate && !obligation) recordDeepest(pos, i);
    return found;
  };

  walk(0, 0, [], {});

  if (edits.size === 0) {
    throw new MatchError(
      `no match: the pattern did not fit the file (deepest progress at step ${deepestStep})`,
      deepestPos < 0 ? 0 : deepestPos,
      deepestStep,
    );
  }
  if (edits.size >= 2) {
    const positions = [...edits.values()].map((m) => map.toOriginalPos(m.insert.pos, m.insert.side));
    throw new AmbiguityError(
      'ambiguous match: the pattern fits in more than one place — add context',
      positions,
    );
  }
  return [...edits.values()][0]!;
}
