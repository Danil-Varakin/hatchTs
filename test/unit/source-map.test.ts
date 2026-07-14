import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { makeSourceMap } from '../../src/lang/build-map.ts';
import { buildCanon } from '../../src/lang/canon.ts';
import { normalize } from '../../src/lang/cpp/index.ts';

// позиция курсора сразу после первого вхождения anchor (в каноне).
// Через matchesAt (точечный, без глубино-фильтра), т.к. occurrences теперь
// балансированный и «где угодно» им не найти.
function cursorAfter(map: ReturnType<typeof cppAdapter.buildMap>, anchor: string): number {
  for (let p = 0; p + anchor.length <= map.eof; p++) {
    if (map.matchesAt(anchor, p)) return p + anchor.length;
  }
  throw new Error(`не найдено вхождение "${anchor}"`);
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

// ── обобщённые скобки: () [] <> тоже блоки, 'a < b' — нет ──────────────────────

test('вложенные () дают разные уровни и enclosingEnd', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void h(){ func(a, d(a, c)); }');
  const outer = cursorAfter(map, 'func('); // внутри внешних ()
  const inner = cursorAfter(map, 'd('); //     внутри внутренних ()
  assert.equal(map.depthAt(inner) - map.depthAt(outer), 1);
  assert.ok(map.matchesAt(')', map.enclosingEnd(outer)));
  assert.ok(map.matchesAt(')', map.enclosingEnd(inner)));
  assert.notEqual(map.enclosingEnd(outer), map.enclosingEnd(inner));
});

test('occurrences отсеивает более глубокие вхождения (баланс ...)', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void h(){ f(a, g(b, c)); }');
  const cur = cursorAfter(map, 'f('); // внутри внешних () — глубина этого уровня
  const commas = map.occurrences(',', cur, map.enclosingEnd(cur));
  assert.equal(commas.length, 1); // только верхняя ',', не из g(b, c)
});

test('[] и <> — блоки, а бинарный < — нет', async () => {
  await cppAdapter.init();
  const sub = cppAdapter.buildMap('arr[i];');
  assert.equal(sub.depthAt(cursorAfter(sub, 'arr[')), 1);
  const tpl = cppAdapter.buildMap('Foo<int> x;');
  assert.equal(tpl.depthAt(cursorAfter(tpl, 'Foo<')), 1);
  const lt = cppAdapter.buildMap('bool f(){ return a < b; }');
  assert.equal(lt.depthAt(cursorAfter(lt, 'return')), 1); // '<' не создал блок
});

test('соседние блоки: enclosingEnd различает своих родителей (индекс по лесу)', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('namespace n { void a(){ x(); } void b(){ y(); } }');
  const inA = cursorAfter(map, 'x();');
  const inB = cursorAfter(map, 'y();');
  assert.equal(map.depthAt(inA), 2); // namespace + тело a
  assert.equal(map.depthAt(inB), 2);
  assert.notEqual(map.enclosingEnd(inA), map.enclosingEnd(inB)); // у каждого своя '}'
  const betweenFns = cursorAfter(map, 'void b'); // внутри namespace, вне тел
  assert.equal(map.depthAt(betweenFns), 1);
  assert.ok(map.matchesAt('}', map.enclosingEnd(betweenFns))); // '}' самого namespace
});

// ── границы токенов юникод-осознанные ─────────────────────────────────────────

test('границы токенов работают для не-ASCII (кириллица)', () => {
  const map = makeSourceMap(buildCanon('Фу,Фубар', normalize), []);
  assert.equal(map.matchesAt('Фу', 0), true); // перед ',' — целый токен
  assert.equal(map.matchesAt('Фу', 3), false); // внутри 'Фубар' — граница слова
});

// ── валидация входов: бросаем на мусоре ───────────────────────────────────────

test('методы карты бросают на некорректном входе', () => {
  const map = makeSourceMap(buildCanon('abc', normalize), []);
  assert.throws(() => map.matchesAt('a', 99)); // pos вне [0,eof]
  assert.throws(() => map.matchesAt('', 0)); // пустой литерал
  assert.throws(() => map.occurrences('a', 2, 1)); // from > to
  assert.throws(() => map.enclosingEnd(-1)); // pos < 0
  // @ts-expect-error side неверный
  assert.throws(() => map.toOriginalPos(0, 'up'));
});

test('canon.toCanonPos/toOriginalPos бросают вне диапазона', () => {
  const c = buildCanon('abc', normalize);
  assert.throws(() => c.toCanonPos(99));
  assert.throws(() => c.toOriginalPos(99, 'left'));
});
