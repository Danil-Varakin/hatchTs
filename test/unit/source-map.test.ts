import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { makeSourceMap } from '../../src/lang/build-map.ts';
import { buildCanon } from '../../src/lang/canon.ts';
import { normalize } from '../../src/lang/cpp/index.ts';

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
  assert.equal(map.depthAt(cur), 3);
  assert.ok(map.matchesAt('}', map.enclosingEnd(cur)));
});

test('enclosing отдаёт пролёты ЦЕЛИКОМ ({open, close}), внутрь→наружу', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('namespace a { class B { void f(){ g(); } }; }');
  const cur = cursorAfter(map, 'g();');
  const spans = map.enclosing(cur);
  assert.equal(spans.length, 3);
  for (const s of spans) {
    assert.ok(map.matchesAt('{', s.open));
    assert.ok(map.matchesAt('}', s.close));
    assert.ok(s.open < cur && cur <= s.close);
  }
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i]!.open < spans[i - 1]!.open);
  assert.equal(spans[0]!.close, map.enclosingEnd(cur));
});

test('скобки в строке/char/комментарии не создают блоков', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void g() { auto s = "{"; char c = \'}\'; /* } */ }');
  const cur = cursorAfter(map, 'auto s');
  assert.equal(map.depthAt(cur), 1);
  assert.ok(map.matchesAt('}', map.enclosingEnd(cur)));
});

test('препроцессор: обе ветки #if/#else в дереве, баланс ок', async () => {
  await cppAdapter.init();
  const src = ['#if A', 'void Foo() {', '#else', 'void Foo(int x) {', '#endif', '  body();', '}'].join('\n');
  const map = cppAdapter.buildMap(src);
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
  assert.equal(map.matchesAt('Foo', 0), false);
  assert.equal(map.matchesAt('Foo', 7), true);
});

test('occurrences находит только целые токены в окне', () => {
  const canon = buildCanon('x = f(x) + xy;', normalize);
  const map = makeSourceMap(canon, []);
  const occ = map.occurrences('x', 0, map.eof);
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
  const outer = cursorAfter(map, 'func(');
  const inner = cursorAfter(map, 'd(');
  assert.equal(map.depthAt(inner) - map.depthAt(outer), 1);
  assert.ok(map.matchesAt(')', map.enclosingEnd(outer)));
  assert.ok(map.matchesAt(')', map.enclosingEnd(inner)));
  assert.notEqual(map.enclosingEnd(outer), map.enclosingEnd(inner));
});

test('occurrences отдаёт ВСЕ текстовые вхождения; enclosingEnd различает уровень', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void h(){ f(a, g(b, c)); }');
  const cur = cursorAfter(map, 'f(');
  const outerClose = map.enclosingEnd(cur);
  const commas = map.occurrences(',', cur, map.eof);
  assert.equal(commas.length, 2);
  const atOuterLevel = commas.filter((p) => map.enclosingEnd(p) === outerClose);
  assert.equal(atOuterLevel.length, 1);
});

test('occurrences: старт на границе to (включительно), хвост может за to', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void f(){ if(x){ a(); } else { b(); } }');
  const cur = cursorAfter(map, 'a();');
  const closeIf = map.enclosingEnd(cur);
  const occ = map.occurrences(normalize('} else {'), cur, closeIf);
  assert.deepEqual(occ, [closeIf]);
  assert.deepEqual(map.occurrences(normalize('b();'), cur, closeIf), []);
});

test('[] и <> — блоки, а бинарный < — нет', async () => {
  await cppAdapter.init();
  const sub = cppAdapter.buildMap('arr[i];');
  assert.equal(sub.depthAt(cursorAfter(sub, 'arr[')), 1);
  const tpl = cppAdapter.buildMap('Foo<int> x;');
  assert.equal(tpl.depthAt(cursorAfter(tpl, 'Foo<')), 1);
  const lt = cppAdapter.buildMap('bool f(){ return a < b; }');
  assert.equal(lt.depthAt(cursorAfter(lt, 'return')), 1);
});

test('соседние блоки: enclosingEnd различает своих родителей (индекс по лесу)', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('namespace n { void a(){ x(); } void b(){ y(); } }');
  const inA = cursorAfter(map, 'x();');
  const inB = cursorAfter(map, 'y();');
  assert.equal(map.depthAt(inA), 2);
  assert.equal(map.depthAt(inB), 2);
  assert.notEqual(map.enclosingEnd(inA), map.enclosingEnd(inB));
  const betweenFns = cursorAfter(map, 'void b');
  assert.equal(map.depthAt(betweenFns), 1);
  assert.ok(map.matchesAt('}', map.enclosingEnd(betweenFns)));
});

// ── заголовок узла (headerStart) и обобщение скобок (blocksWithin) ─────────────

test('headerStart: пролёт тела несёт начало ЗАГОЛОВКА узла, не строку с "{"', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void foo(int a)\n{\n  g();\n}\n');
  const s = map.enclosing(cursorAfter(map, 'g();'))[0]!;
  assert.ok(s.headerStart !== undefined);
  assert.ok(map.matchesAt('void', s.headerStart!));
  assert.ok(s.headerStart! < s.open);
});

test('blocksWithin: отдаёт скобочные пролёты ЦЕЛИКОМ внутри диапазона (для обобщения)', async () => {
  await cppAdapter.init();
  const map = cppAdapter.buildMap('void foo(int a, int b) {\n  g();\n}\n');
  const s = map.enclosing(cursorAfter(map, 'g();'))[0]!;
  const inHeader = map.blocksWithin(s.headerStart!, s.open);
  assert.equal(inHeader.length, 1);
  assert.ok(map.matchesAt('(', inHeader[0]!.open));
  assert.ok(map.matchesAt(')', inHeader[0]!.close));
  assert.deepEqual(map.blocksWithin(0, 1), []);
  assert.throws(() => map.blocksWithin(2, 1));
});

// ── границы токенов юникод-осознанные ─────────────────────────────────────────

test('границы токенов работают для не-ASCII (кириллица)', () => {
  const map = makeSourceMap(buildCanon('Фу,Фубар', normalize), []);
  assert.equal(map.matchesAt('Фу', 0), true);
  assert.equal(map.matchesAt('Фу', 3), false);
});

// ── валидация входов: бросаем на мусоре ───────────────────────────────────────

test('методы карты бросают на некорректном входе', () => {
  const map = makeSourceMap(buildCanon('abc', normalize), []);
  assert.throws(() => map.matchesAt('a', 99));
  assert.throws(() => map.matchesAt('', 0));
  assert.throws(() => map.occurrences('a', 2, 1));
  assert.throws(() => map.enclosingEnd(-1));
  // @ts-expect-error
  assert.throws(() => map.toOriginalPos(0, 'up'));
});

test('canon.toCanonPos/toOriginalPos бросают вне диапазона', () => {
  const c = buildCanon('abc', normalize);
  assert.throws(() => c.toCanonPos(99));
  assert.throws(() => c.toOriginalPos(99, 'left'));
});
