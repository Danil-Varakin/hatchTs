import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCanon } from '../../src/lang/canon.ts';
import { normalize } from '../../src/lang/cpp/normalize.ts';

const c = (s: string) => buildCanon(s, normalize);

test('text == normalize(source)', () => {
  const src = 'int   x = 1;';
  assert.equal(c(src).text, normalize(src));
  assert.equal(c(src).text, 'int x=1;');
});

test('toCanonPos: позиция токена в оригинале → позиция в каноне', () => {
  const m = c('int   x = 1;');
  assert.equal(m.toCanonPos(6), 4); // 'x': orig 6 → canon 4
  assert.equal(m.toCanonPos(0), 0); // BOF
});

test('round-trip: toOriginalPos(toCanonPos(i),right) == i на всех непробельных', () => {
  const src = 'namespace  a {\n  foo();\n}';
  const m = c(src);
  for (let i = 0; i < src.length; i++) {
    if (/\S/.test(src[i]!)) {
      assert.equal(m.toOriginalPos(m.toCanonPos(i), 'right'), i, `pos ${i} (${src[i]})`);
    }
  }
});

test('side=left ставит метку сразу после предыдущего непробельного', () => {
  const m = c('a   b'); // canon 'a b'
  assert.equal(m.toCanonPos(4), 2); // 'b': orig 4 → canon 2
  assert.equal(m.toOriginalPos(2, 'left'), 1); // сразу после 'a'
  assert.equal(m.toOriginalPos(2, 'right'), 4); // прямо перед 'b'
});

test('края: BOF / EOF / пустой файл', () => {
  const m = c('a b');
  assert.equal(m.toOriginalPos(0, 'left'), 0); // BOF
  assert.equal(m.toOriginalPos(m.text.length, 'right'), 3); // EOF = source.length
  const e = c('');
  assert.equal(e.text, '');
  assert.equal(e.toOriginalPos(0, 'left'), 0);
  assert.equal(e.toOriginalPos(0, 'right'), 0);
});

test('канон схлопывает разное форматирование к одному тексту', () => {
  assert.equal(c('Foo( int  x )').text, c('Foo(int x)').text);
});
