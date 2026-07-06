// lang/treesitter.ts — ОБЩИЙ движок tree-sitter, язык-нейтральный.
// Parser.init один раз на процесс; грамматики кешируются по пути к .wasm.
import { Parser, Language } from 'web-tree-sitter';
import type { Tree, Node } from 'web-tree-sitter';

export type { Language, Tree, Node } from 'web-tree-sitter';

let initOnce: Promise<void> | null = null;
let parser: Parser | null = null;
const grammars = new Map<string, Promise<Language>>();

export function loadGrammar(wasmPath: string): Promise<Language> {
  let g = grammars.get(wasmPath);
  if (g === undefined) {
    g = (initOnce ??= Parser.init()).then(() => Language.load(wasmPath));
    grammars.set(wasmPath, g);
  }
  return g;
}

export function parse(grammar: Language, source: string): Tree {
  (parser ??= new Parser()).setLanguage(grammar);
  const tree = parser.parse(source);
  if (tree === null) throw new Error('tree-sitter: parse() вернул null');
  return tree;
}

// Преордер-обход через один TreeCursor (без рекурсии, минимум аллокаций узлов).
export function* walk(tree: Tree): Generator<Node> {
  const cursor = tree.walk();
  try {
    yield cursor.currentNode;
    let descend = true;
    for (;;) {
      if (descend && cursor.gotoFirstChild()) {
        yield cursor.currentNode;
      } else if (cursor.gotoNextSibling()) {
        yield cursor.currentNode;
        descend = true;
      } else if (cursor.gotoParent()) {
        descend = false;
      } else {
        break;
      }
    }
  } finally {
    cursor.delete();
  }
}
