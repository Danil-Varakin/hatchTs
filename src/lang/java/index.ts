import { makeAdapter } from '../make-adapter.ts';
import { isWordChar } from '../word.ts';
import { replaceWhitespaceOutsideStrings } from '../zones.ts';
import type { StringRule } from '../zones.ts';
import type { Node } from '../treesitter.ts';
import type { BlockOf, OrigSpan } from '../block-spans.ts';

// String literals of this language. Whitespace inside them is DATA, so canon keeps it
// verbatim (lang/zones.ts). Order matters: longer openers first.
const STRINGS: readonly StringRule[] = [
  { open: '"""', close: '"""', escape: '\\', multiline: true }, // text block
  { open: '"', close: '"', escape: '\\' },
  { open: "'", close: "'", escape: '\\' },
];

export function normalize(raw: string): string {
  return replaceWhitespaceOutsideStrings(raw, STRINGS, (ws, off) =>
    off > 0 && isWordChar(raw[off - 1]!) && isWordChar(raw[off + ws.length] ?? '')
      ? ' '
      : '',
  );
}

const PAIR = new Map<string, string>([
  ['{', '}'],
  ['(', ')'],
  ['[', ']'],
  ['<', '>'], 
]);

function bracketPair(node: Node): { first: Node; last: Node } | null {
  if (!node.isNamed) return null;
  const first = node.firstChild;
  if (first === null) return null;
  const wantClose = PAIR.get(first.type);
  if (wantClose === undefined) return null;
  const last = node.lastChild;
  if (last === null || last.type !== wantClose) return null;
  return { first, last };
}

const javaBlockOf: BlockOf = (node: Node): OrigSpan | null => {
  const pair = bracketPair(node);
  if (pair === null) return null;
  const { first, last } = pair;
  const span: OrigSpan = { open: first.startIndex, close: last.startIndex, closeEnd: last.endIndex };
  const parent = node.parent;
  if (parent !== null && bracketPair(parent) === null && parent.startIndex < node.startIndex) {
    span.headerStart = parent.startIndex;
  }
  return span;
};

export const javaAdapter = makeAdapter({
  grammar: {
    file: 'tree-sitter-java.wasm',
    package: 'tree-sitter-java',
    version: '0.23.5',
    sha256: '4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4',
  },
  extensions: ['.java'],
  normalize,
  blockOf: javaBlockOf,
});
