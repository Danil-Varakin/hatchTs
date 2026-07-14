// lang/cpp/blocks.ts — правило «что такое блок» для C++: узел, у которого первый
// дочерний токен — открывающая скобка, а последний — её пара. Одним правилом ловит
// {} (тела, классы, namespace, enum, initializer), () (аргументы, параметры),
// [] (индекс), <> (шаблоны). На УЗЛАХ, поэтому 'a < b' скобкой НЕ станет.
import { walk } from '../treesitter.ts';
import type { Tree } from '../treesitter.ts';
import type { BlockSpan } from '../build-map.ts';

const PAIR: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']', '<': '>' };

export function cppBlockSpans(tree: Tree, toCanonPos: (origPos: number) => number): BlockSpan[] {
  const spans: BlockSpan[] = [];
  for (const node of walk(tree)) {
    if (!node.isNamed) continue;
    const first = node.firstChild;
    if (first === null) continue;
    const wantClose = PAIR[first.type];
    if (wantClose === undefined) continue;
    const last = node.lastChild;
    if (last === null || last.type !== wantClose) continue;
    spans.push({
      open: toCanonPos(first.startIndex),
      close: toCanonPos(last.startIndex),
    });
  }
  return spans;
}
