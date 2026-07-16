import { Parser, Language } from 'web-tree-sitter';
import type { Tree, Node } from 'web-tree-sitter';

export type { Language, Tree, Node } from 'web-tree-sitter';

let initOnce: Promise<void> | null = null;
let parser: Parser | null = null;
const grammars = new Map<string, Promise<Language>>();

// Отказ инициализации/загрузки НЕ кешируем: иначе первый сбой (нет файла, битый
// .wasm) залипает в кеше навсегда и каждый следующий вызов получает ту же ошибку.
function ensureInit(): Promise<void> {
  if (initOnce === null) {
    const p = Parser.init();
    p.catch(() => {
      if (initOnce === p) initOnce = null;
    });
    initOnce = p;
  }
  return initOnce;
}

export function loadGrammar(wasmPath: string): Promise<Language> {
  if (typeof wasmPath !== 'string' || wasmPath.length === 0) {
    throw new Error('loadGrammar: empty path to .wasm');
  }
  let g = grammars.get(wasmPath);
  if (g === undefined) {
    const p = ensureInit().then(() => Language.load(wasmPath));
    p.catch(() => {
      if (grammars.get(wasmPath) === p) grammars.delete(wasmPath);
    });
    grammars.set(wasmPath, p);
    g = p;
  }
  return g;
}

export function parse(grammar: Language, source: string): Tree {
  (parser ??= new Parser()).setLanguage(grammar);
  const tree = parser.parse(source);
  if (tree === null) throw new Error('tree-sitter: parse() returned null');
  return tree;
}

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
