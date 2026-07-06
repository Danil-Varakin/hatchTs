import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/cpp/normalize.ts';

test('a significant gap between words collapses into one', () => {
  assert.equal(normalize('int x'), 'int x');
  assert.equal(normalize('int   x'), 'int x');
  assert.equal(normalize('int\tx'), 'int x');
});

test('"int x" ≠ "intx" (the gap is not lost)', () => {
  assert.notEqual(normalize('int x'), normalize('intx'));
});

test('the space around the punctuation is thrown out', () => {
  assert.equal(normalize('features {'), 'features{');
  assert.equal(normalize('Foo( int x )'), 'Foo(int x)');
  assert.equal(normalize('p -> x'), 'p->x');
});

test('the leading indentation for C++ is insignificant — it is thrown out', () => {
  assert.equal(normalize('    foo'), 'foo');
  assert.equal(normalize('  a'), normalize('a'));
  assert.equal(normalize('  a'), normalize('        a'));
});

test('Line break: there is a significant space between words, and the punctuation is off.', () => {
  assert.equal(normalize('foo\nbar'), 'foo bar');
  assert.equal(normalize('}\n// namespace'), '}//namespace');
});

test('Wrapped signature ≡ single - line', () => {
  assert.equal(normalize('Foo(int x,\n int y)'), normalize('Foo(int x, int y)'));
  assert.equal(normalize('Foo(int x,\n int y)'), 'Foo(int x,int y)');
});

test('merging operators (consequence of the rule, harmless)', () => {
  assert.equal(normalize('> >'), '>>');
  assert.equal(normalize(': :'), '::');
});

test('A WELL-KNOWN LIMITATION is that the space inside the lines also collapses.', () => {
  assert.equal(normalize('"a  b"'), '"a b"');
  assert.equal(normalize('" "'), '""');
});

test('idempotence: normalize(normalize(x)) == normalize(x)', () => {
  for (const s of ['int   x', 'Foo( int x )', '}\n// ns', '> >']) {
    assert.equal(normalize(normalize(s)), normalize(s));
  }
});