// Python canon: leading indentation is KEPT as the level marker, the rest of the line
// follows the C-like rule. '\n' is significant, so it survives canon too.
//
// One pass over the whole text, not line by line: a triple-quoted string spans lines,
// and its interior must come out verbatim (lang/zones.ts). The line rules are expressed
// per whitespace run instead, which comes out equivalent — see the cases below.
import { isWordChar } from '../word.ts';
import { replaceWhitespaceOutsideStrings } from '../zones.ts';
import type { StringRule } from '../zones.ts';

// String literals of this language. Whitespace inside them is DATA, so canon keeps it
// verbatim. Order matters: longer openers first, or `"""` would read as an empty `""`.
// A prefix (f, r, b, u, rb…) stays code — the quote is what opens the literal.
const STRINGS: readonly StringRule[] = [
  { open: '"""', close: '"""', escape: '\\', multiline: true },
  { open: "'''", close: "'''", escape: '\\', multiline: true },
  { open: '"', close: '"', escape: '\\' },
  { open: "'", close: "'", escape: '\\' },
];

export function normalize(raw: string): string {
  return replaceWhitespaceOutsideStrings(raw, STRINGS, (ws, off) => collapseRun(raw, ws, off));
}

/**
 * What a whitespace run outside a string becomes:
 *
 *   • at offset 0            → kept: it is the first line's indentation;
 *   • containing a newline   → newlines kept, then the tail after the LAST newline kept
 *                              (that tail is the next line's indentation); whatever sat
 *                              before the first newline was trailing space, and goes;
 *   • otherwise              → the C-like rule: one space between two word characters,
 *                              nothing anywhere else.
 */
function collapseRun(raw: string, ws: string, off: number): string {
  if (off === 0) return ws;
  const lastNewline = ws.lastIndexOf('\n');
  if (lastNewline !== -1) {
    const newlines = ws.slice(0, lastNewline + 1).replace(/[^\n]/g, '');
    return newlines + ws.slice(lastNewline + 1);
  }
  return isWordChar(raw[off - 1]!) && isWordChar(raw[off + ws.length] ?? '') ? ' ' : '';
}
