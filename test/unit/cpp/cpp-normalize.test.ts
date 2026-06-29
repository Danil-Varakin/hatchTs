// ============================================================================
// test/unit/cpp/normalize.test.ts — канон литерала по правилам C++.
// Тестируется В ОТРЫВЕ от матчера (00-general-rules §2): чистая функция вход→выход.
// Правило: пробел значим ТОЛЬКО между двумя \w-символами; всё прочее (вокруг
// пунктуации, \n, ведущий отступ) выкидывается (00-general-rules §4).
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/cpp/normalize.ts';

test('значимый пробел между словами схлопывается в один', () => {
  assert.equal(normalize('int x'), 'int x');
  assert.equal(normalize('int   x'), 'int x');
  assert.equal(normalize('int\tx'), 'int x');
});

test('«int x» ≠ «intx» (зазор не теряется)', () => {
  assert.notEqual(normalize('int x'), normalize('intx'));
});

test('пробел вокруг пунктуации выкидывается', () => {
  assert.equal(normalize('features {'), 'features{');
  assert.equal(normalize('Foo( int x )'), 'Foo(int x)');
  assert.equal(normalize('p -> x'), 'p->x');
});

test('ведущий отступ для C++ незначим — выкидывается', () => {
  assert.equal(normalize('    foo'), 'foo');
  assert.equal(normalize('  a'), normalize('a'));
  assert.equal(normalize('  a'), normalize('        a'));
});

test('перенос строки: между словами — значимый пробел, у пунктуации — прочь', () => {
  assert.equal(normalize('foo\nbar'), 'foo bar');
  assert.equal(normalize('}\n// namespace'), '}//namespace');
});

test('обёрнутая сигнатура ≡ однострочной', () => {
  assert.equal(normalize('Foo(int x,\n int y)'), normalize('Foo(int x, int y)'));
  assert.equal(normalize('Foo(int x,\n int y)'), 'Foo(int x,int y)');
});

test('слияние операторов (следствие правила, безвредно)', () => {
  assert.equal(normalize('> >'), '>>');
  assert.equal(normalize(': :'), '::');
});

test('ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: пробел внутри строк тоже схлопывается', () => {
  // зафиксировано как постоянное поведение (00-general-rules §4): обе стороны
  // канонятся одинаково, само-совпадение держится.
  assert.equal(normalize('"a  b"'), '"a b"');
  assert.equal(normalize('" "'), '""');
});

test('идемпотентность: normalize(normalize(x)) == normalize(x)', () => {
  for (const s of ['int   x', 'Foo( int x )', '}\n// ns', '> >']) {
    assert.equal(normalize(normalize(s)), normalize(s));
  }
});