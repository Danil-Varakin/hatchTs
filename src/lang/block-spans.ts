// lang/block-spans.ts — ОБЩИЙ: обход дерева tree-sitter и сбор пролётов блоков.
// Обход одинаков для ВСЕХ языков; ЧТО считается блоком и где его границы — язык
// решает через blockOf(node). Так дублирующий цикл walk() живёт здесь в одном
// экземпляре, а в папке языка остаётся только правило вложенности.
import { walk } from './treesitter.ts';
import type { Tree, Node } from './treesitter.ts';
import type { BlockSpan } from './source-map.ts';

// Пролёт в ОРИГИНАЛЬНЫХ смещениях (startIndex/endIndex узлов), ДО переноса в канон.
export interface OrigSpan {
  open: number; // оригинальное смещение начала блока (у C++ — '{', у Python — тело)
  close: number; // оригинальное смещение конца блока (у C++ — '}', у Python — конец тела)
}

// Правило языка: пролёт блока для узла ИЛИ null, если узел блоком не является.
// C++ проверяет пару скобок first/lastChild; Python — тип узла ('block'). Правило
// работает на УЗЛАХ дерева, поэтому языкам с отступами (Python) не нужно вручную
// сравнивать табуляцию — границы блока уже посчитал tree-sitter.
export type BlockOf = (node: Node) => OrigSpan | null;

export function collectBlockSpans(
  tree: Tree,
  toCanonPos: (origPos: number) => number,
  blockOf: BlockOf,
): BlockSpan[] {
  const spans: BlockSpan[] = [];
  for (const node of walk(tree)) {
    const span = blockOf(node);
    if (span === null) continue;
    spans.push({ open: toCanonPos(span.open), close: toCanonPos(span.close) });
  }
  return spans;
}
