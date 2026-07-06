// lang/cpp/blocks.ts — правило «что такое блок» для C++: узел, у которого первый
// дочерний токен '{' и последний '}'. Ловит compound_statement, declaration_list,
// field_declaration_list, enumerator_list, initializer_list и пр. одним правилом
// (устойчиво к переименованиям узлов между версиями грамматики).
import { walk } from '../treesitter.ts';
import type { Tree } from '../treesitter.ts';
import type { BlockSpan } from '../build-map.ts';

export function cppBlockSpans(tree: Tree, toCanonPos: (origPos: number) => number): BlockSpan[] {
  const spans: BlockSpan[] = [];
  for (const node of walk(tree)) {
    if (!node.isNamed) continue;
    const first = node.firstChild;
    if (first === null || first.type !== '{') continue;
    const last = node.lastChild;
    if (last === null || last.type !== '}') continue;
    spans.push({
      open: toCanonPos(first.startIndex),
      close: toCanonPos(last.startIndex),
    });
  }
  return spans;
}
