import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { makeSourceMap } from '../../src/lang/build-map.ts';
import { buildCanon } from '../../src/lang/canon.ts';
import { normalize } from '../../src/lang/cpp/normalize.ts';

// позиция курсора сразу после первого вхождения anchor (в каноне)
function cursorAfter(map: ReturnType<typeof cppAdapter.buildMap>, anchor: string): number {
  const occ = map.occurrences(anchor, 0, map.eof);
  assert.equal(occ.length, 1, `ожидалось одно вхождение "${anchor}"`);
  return occ[0]! + anchor.length;
}

test('вложенность: enclosingEnd прыгает на "}" своего уровня, depthAt считает', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('namespace a { class B { void f(){ g(); } }; }');
  const cur = cursorAfter(map, 'g();');
  assert.equal(map.depthAt(cur), 3); // namespace + class + функция
  assert.ok(map.matchesAt('}', map.enclosingEnd(cur))); // цель = закрывающая f
});

test('скобки в строке/char/комментарии не создают блоков', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void g() { auto s = "{"; char c = \'}\'; /* } */ }');
  const cur = cursorAfter(map, 'auto s'); // канон хранит значимый пробел между словами
  assert.equal(map.depthAt(cur), 1); // единственный настоящий блок — тело g()
  assert.ok(map.matchesAt('}', map.enclosingEnd(cur)));
});

test('препроцессор: обе ветки #if/#else в дереве, баланс ок', async () => {
  await cppAdapter.init();
  const src = ['#if A', 'void Foo() {', '#else', 'void Foo(int x) {', '#endif', '  body();', '}'].join('\n');
  const map = cppAdapter.buildMap(src); // не должен бросить (канон-синк ок)
  const cur = cursorAfter(map, 'body();');
  assert.ok(map.depthAt(cur) >= 1);
  assert.ok(map.matchesAt('}', map.enclosingEnd(cur)));
});

test('верхний уровень: enclosingEnd == eof', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('int x = 1;\nint y = 2;\n');
  assert.equal(map.enclosingEnd(0), map.eof);
  assert.equal(map.depthAt(0), 0);
});

// ── matchesAt / occurrences: границы токенов (чистая функция, без tree-sitter) ──

test('matchesAt уважает границы токенов: Foo не совпадает в FooBar', () => {
  const map = makeSourceMap(buildCanon('FooBar Foo', normalize), []);
  assert.equal(map.matchesAt('Foo', 0), false); // FooBar — справа словесный
  assert.equal(map.matchesAt('Foo', 7), true); // отдельное Foo
});

test('occurrences находит только целые токены в окне', () => {
  const canon = buildCanon('x = f(x) + xy;', normalize);
  const map = makeSourceMap(canon, []);
  const occ = map.occurrences('x', 0, map.eof);
  // 'x' как отдельный токен: первый x и x внутри f(x); НЕ 'xy'
  for (const p of occ) assert.equal(map.matchesAt('x', p), true);
  assert.equal(occ.length, 2);
});

test('matchesAt на "}" не требует границы (пунктуация)', () => {
  const map = makeSourceMap(buildCanon('a{}', normalize), []);
  assert.equal(map.matchesAt('{', 1), true);
  assert.equal(map.matchesAt('}', 2), true);
});
