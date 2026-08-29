import type { SourceMap } from '../lang/source-map.ts';
import type { MatchMarks } from './matcher.ts';

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export function planEdit(marks: MatchMarks, map: SourceMap, patch: string): Edit {
  const start = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  const end =
    marks.replaceEnd === undefined ? start : map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  if (end < start) {
    throw new RangeError(`patcher: replace end ${end} is before insert start ${start}`);
  }
  return { start, end, text: patch };
}

export function applyEdit(source: string, edit: Edit): string {
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

export function patchHunk(
  source: string,
  map: SourceMap,
  marks: MatchMarks,
  patch: string,
): { source: string; edit: Edit } {
  const edit = planEdit(marks, map, patch);
  return { source: applyEdit(source, edit), edit };
}
