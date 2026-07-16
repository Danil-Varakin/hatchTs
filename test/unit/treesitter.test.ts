import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { loadGrammar, parse, walk } from '../../src/lang/treesitter.ts';

const CPP = join(import.meta.dirname, '../../grammars/tree-sitter-cpp.wasm');

function blockSpans(src: string, tree: ReturnType<typeof parse>): [number, number][] {
  const spans: [number, number][] = [];
  for (const n of walk(tree)) {
    if (n.isNamed && n.firstChild?.type === '{' && n.lastChild?.type === '}') {
      spans.push([n.startIndex, n.endIndex]);
    }
  }
  return spans;
}

test('parse + walk: вложенные блоки C++ по правилу первый{/последний}', async () => {
  const g = await loadGrammar(CPP);
  const src = 'namespace a { class B { void f(){ x(); } }; }';
  const tree = parse(g, src);
  try {
    const spans = blockSpans(src, tree);
    assert.equal(spans.length, 3); // namespace, class, функция
    const inner = spans[spans.length - 1]!;
    assert.equal(src.slice(inner[0], inner[1]), '{ x(); }'); // индексы = срез JS-строки
  } finally {
    tree.delete();
  }
});

test('строки/char/комментарии не дают ложных блоков', async () => {
  const g = await loadGrammar(CPP);
  const src = 'void g() { auto s = "{"; char c = \'}\'; /* } */ }';
  const tree = parse(g, src);
  try {
    assert.equal(blockSpans(src, tree).length, 1); // только тело g()
  } finally {
    tree.delete();
  }
});

test('loadGrammar кеширует грамматику', async () => {
  assert.equal(await loadGrammar(CPP), await loadGrammar(CPP));
});
