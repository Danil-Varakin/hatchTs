// One language is one folder with all of its rules inside, even when a rule is
// identical to a neighbour's: adding a language means copying a folder and editing one
// file.
import { makeAdapter } from '../make-adapter.ts';
import { isWordChar } from '../word.ts';
import type { Node } from '../treesitter.ts';
import type { BlockOf, OrigSpan } from '../block-spans.ts';

// Whitespace matters only between two word characters, where it collapses to one
// space; everywhere else it is dropped.
export function normalize(raw: string): string {
  return raw.replace(/\s+/g, (ws, off: number) =>
    off > 0 && isWordChar(raw[off - 1]!) && isWordChar(raw[off + ws.length] ?? '')
      ? ' '
      : '',
  );
}

// A block is a named node whose first child token is an opening bracket and whose last
// is its pair. Working on NODES is what keeps `a < b` from looking like `Foo<Bar>`.
//
// A Map rather than an object literal: an object literal would answer 'constructor' or
// '__proto__' with an inherited function instead of undefined.
const PAIR = new Map<string, string>([
  ['{', '}'],
  ['(', ')'],
  ['[', ']'],
  ['<', '>'], // templates: Foo<Bar>, std::vector<int>
]);

// Needed twice: for the block itself and to check whether its owner is one.
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

const cppBlockOf: BlockOf = (node: Node): OrigSpan | null => {
  const pair = bracketPair(node);
  if (pair === null) return null;
  const { first, last } = pair;
  // [close, closeEnd) is the closing token itself, which synth needs to close the
  // block inside a pattern.
  const span: OrigSpan = { open: first.startIndex, close: last.startIndex, closeEnd: last.endIndex };
  // The header starts at the OWNER node, so the anchor becomes `void foo(int a)` and
  // not "the line with a brace". A bare nested block owns itself and has no header.
  const parent = node.parent;
  if (parent !== null && bracketPair(parent) === null && parent.startIndex < node.startIndex) {
    span.headerStart = parent.startIndex;
  }
  return span;
};


export const cppAdapter = makeAdapter({
  grammar: {
    file: 'tree-sitter-cpp.wasm',
    package: 'tree-sitter-cpp',
    version: '0.23.4',
    sha256: '174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf',
  },
  extensions: ['.cc', '.cpp', '.cxx', '.h', '.hpp', '.inc'], // .h is C++ in Chromium
  normalize,
  blockOf: cppBlockOf,
});
