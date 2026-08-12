import { walk } from './treesitter.ts';
import type { Tree, Node } from './treesitter.ts';
import type { BlockSpan } from './source-map.ts';

export interface OrigSpan {
  open: number; 
  close: number; 
  headerStart?: number; 
  closeEnd?: number; 
}

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
    const out: BlockSpan = { open: toCanonPos(span.open), close: toCanonPos(span.close) };
    if (span.headerStart !== undefined) out.headerStart = toCanonPos(span.headerStart);
    if (span.closeEnd !== undefined) out.closeEnd = toCanonPos(span.closeEnd);
    spans.push(out);
  }
  return spans;
}
