import type { SourceMap } from '../lang/source-map.ts';
import type { MatchMarks } from './matcher.ts';

export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Where the marks cut the ORIGINAL text: `[start, end)` is what the patch replaces. */
export function cutOf(map: SourceMap, marks: MatchMarks): { start: number; end: number } {
  const start = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  const end =
    marks.replaceEnd === undefined ? start : map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  if (end < start) {
    throw new RangeError(`patcher: replace end ${end} is before insert start ${start}`);
  }
  return { start, end };
}

export function planEdit(source: string, map: SourceMap, marks: MatchMarks, patch: string): Edit {
  const { start, end } = cutOf(map, marks);
  return { start, end, text: landed(patch, lineEndAt(source, start)) };
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
  const edit = planEdit(source, map, marks, patch);
  return { source: applyEdit(source, edit), edit };
}

// ── line endings ─────────────────────────────────────────────────────────────────
//
// A patch body has no line ending of its own: the .md is text, and git (autocrlf,
// `text=auto`) or an editor may turn its line ends either way on the road — the parser
// reads `\r\n` and `\n` alike. So the ending is the TARGET's: a bare LF of the patch
// takes the ending of the line the edit starts on. Only a CRLF line changes anything —
// in an LF file the patch lands byte for byte as before.
//
// The line the edit starts on, not the file as a whole: a file with mixed endings
// (golden cpp/74 — an LF header over CRLF lines, converted to LF) keeps what each place
// already has. An edit never starts between `\r` and `\n`: marks sit next to a
// non-whitespace character, or at BOF/EOF.

function lineEndAt(source: string, at: number): '\r\n' | '\n' {
  let nl = source.indexOf('\n', at);
  if (nl === -1) nl = source.lastIndexOf('\n', at - 1);
  return nl > 0 && source[nl - 1] === '\r' ? '\r\n' : '\n';
}

function landed(patch: string, lineEnd: '\r\n' | '\n'): string {
  return lineEnd === '\n' ? patch : patch.replace(/(?<!\r)\n/g, '\r\n');
}
