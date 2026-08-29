import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadGrammar, parse, walk } from '../../src/lang/treesitter.ts';
import { resolveGrammar } from '../../src/infra/grammar-store.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';

const cpp = async () => loadGrammar('cpp-test', await resolveGrammar(cppAdapter.grammar));

function blockSpans(src: string, tree: ReturnType<typeof parse>): [number, number][] {
  const spans: [number, number][] = [];
  for (const n of walk(tree)) {
    if (n.isNamed && n.firstChild?.type === '{' && n.lastChild?.type === '}') {
      spans.push([n.startIndex, n.endIndex]);
    }
  }
  return spans;
}

test('parse + walk: nested C++ blocks by the first-{ / last-} rule', async () => {
  const g = await cpp();
  const src = 'namespace a { class B { void f(){ x(); } }; }';
  const tree = parse(g, src);
  try {
    const spans = blockSpans(src, tree);
    assert.equal(spans.length, 3);
    const inner = spans[spans.length - 1]!;
    assert.equal(src.slice(inner[0], inner[1]), '{ x(); }');
  } finally {
    tree.delete();
  }
});

test('strings, chars and comments raise no false blocks', async () => {
  const g = await cpp();
  const src = 'void g() { auto s = "{"; char c = \'}\'; /* } */ }';
  const tree = parse(g, src);
  try {
    assert.equal(blockSpans(src, tree).length, 1);
  } finally {
    tree.delete();
  }
});

test('loadGrammar caches the grammar', async () => {
  assert.equal(await cpp(), await cpp());
});
