
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

test('whitespace inside a string literal is DATA and survives canon', () => {
  assert.equal(normalize('    log("a  b")'), '    log("a  b")');
  assert.notEqual(normalize('log("a  b")'), normalize('log("a b")'));
  assert.equal(normalize("    x = ' '"), "    x=' '");
});

test('a one-line triple-quoted string is opaque like any other', () => {
  assert.equal(normalize('    d = """a  b"""'), '    d="""a  b"""');
});

test('a MULTI-LINE docstring stays transparent, and that is deliberate', () => {
  const doc = 'def f():\n    """Summary.\n\n    Detail   with   gaps.\n    """\n    return 1';
  assert.ok(!normalize(doc).includes('Detail   with   gaps.'));
  assert.ok(normalize(doc).includes('Detail with gaps.'));
});

test('a prefixed literal (f, r, rb) is a literal too', () => {
  assert.equal(normalize('    x = f"a  {b}  c"'), '    x=f"a  {b}  c"');
  assert.equal(normalize("    p = r'a  b'"), "    p=r'a  b'");
});

test('idempotence holds with strings in play', () => {
  for (const s of ['    log("a  b")', 'def f():\n    """a  b\n    """\n    return 1']) {
    assert.equal(normalize(normalize(s)), normalize(s));
  }
});
