
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/python/normalize.ts';

test('The leading indentation of the line IS PRESERVED', () => {
  assert.equal(normalize('    return None'), '    return None');
  assert.equal(normalize('\tx = 1'), '\tx=1');
});

test('DIFFERENT indentation → DIFFERENT canon (unlike C++)', () => {
  assert.notEqual(normalize('  a'), normalize('    a'));
});

test('the string body is cleaned as in C-like', () => {
  assert.equal(normalize('def  foo():'), 'def foo():');
  assert.equal(normalize('    x = 1'), '    x=1');
  assert.equal(normalize('    a  +  b'), '    a+b');
});

test('a significant gap between words in the body collapses, but is not lost.', () => {
  assert.equal(normalize('    return  None'), '    return None');
  assert.notEqual(normalize('return None'), normalize('returnNone'));
});

test('multiline literal: line by line + gluing through \\n (\\n is significant)', () => {
  assert.equal(
    normalize('def foo():\n    return None'),
    'def foo():\n    return None',
  );

  assert.equal(
    normalize('def f():\n    if x:\n        y = 1'),
    'def f():\n    if x:\n        y=1',
  );
});

test('unicode: non-ASCII words in the body do not merge', () => {
  assert.equal(normalize('    имя значение'), '    имя значение');
});

test('idempotence', () => {
  for (const s of ['    x = 1', 'def  foo():', 'def f():\n    return None']) {
    assert.equal(normalize(normalize(s)), normalize(s));
  }
});