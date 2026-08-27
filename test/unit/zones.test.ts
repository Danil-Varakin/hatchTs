import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stringZones, inZone, replaceWhitespaceOutsideStrings } from '../../src/lang/zones.ts';
import type { StringRule } from '../../src/lang/zones.ts';

const C_LIKE: readonly StringRule[] = [
  { open: '"', close: '"', escape: '\\' },
  { open: "'", close: "'", escape: '\\' },
];

const zonesOf = (text: string, rules: readonly StringRule[] = C_LIKE): string[] =>
  stringZones(text, rules).map((z) => text.slice(z.start, z.end));

test('a zone includes its delimiters and stops there', () => {
  assert.deepEqual(zonesOf('a = "one" + "two";'), ['"one"', '"two"']);
  assert.deepEqual(zonesOf('no strings here'), []);
});

test('an escaped delimiter does not close the zone', () => {
  assert.deepEqual(zonesOf('"a\\"b"'), ['"a\\"b"']);
  assert.deepEqual(zonesOf('"\\\\" + "x"'), ['"\\\\"', '"x"']);
});

test('a single-line literal that is never closed ends with its line', () => {
  assert.deepEqual(zonesOf('f("oops\nint x = 1;'), ['"oops']);
  assert.equal(stringZones('f("oops\nint x = 1;', C_LIKE)[0]!.end, 7);
});

test('a quote inside another quote is text, not a new zone', () => {
  assert.deepEqual(zonesOf(`"it's"`), [`"it's"`]);
  assert.deepEqual(zonesOf(`'say "hi"'`), [`'say "hi"'`]);
});

test('rules are tried in order: the longer opener must come first', () => {
  const py: readonly StringRule[] = [
    { open: '"""', close: '"""', escape: '\\', multiline: true },
    { open: '"', close: '"', escape: '\\' },
  ];
  assert.deepEqual(zonesOf('x = """a\n  b""" + "c"', py), ['"""a\n  b"""', '"c"']);
  const wrong: readonly StringRule[] = [py[1]!, py[0]!];
  assert.notDeepEqual(zonesOf('x = """a\n  b""" + "c"', wrong), ['"""a\n  b"""', '"c"']);
});

test('opacity is decided by the text: a newline inside makes a zone transparent', () => {
  const py: readonly StringRule[] = [
    { open: '"""', close: '"""', escape: '\\', multiline: true },
    { open: '"', close: '"', escape: '\\' },
  ];
  assert.deepEqual(
    stringZones('a = """x  y"""', py).map((z) => z.opaque),
    [true],
  );
  assert.deepEqual(
    stringZones('a = """x\n  y"""', py).map((z) => z.opaque),
    [false],
  );
  assert.deepEqual(zonesOf('a = """x\n "b" y"""', py), ['"""x\n "b" y"""']);
});

test('a delimiter computed from the opening match (C++ raw string)', () => {
  const raw: readonly StringRule[] = [
    { open: /R"([^\s()\\]{0,16})\(/, close: (m) => `)${m[1] ?? ''}"`, multiline: true },
    ...C_LIKE,
  ];
  assert.deepEqual(zonesOf('s = R"(a "b" c)";', raw), ['R"(a "b" c)"']);
  assert.deepEqual(zonesOf('s = R"tag(a )" b)tag";', raw), ['R"tag(a )" b)tag"']);
  assert.deepEqual(stringZones('R"(a\n  b)"', raw).map((z) => z.opaque), [false]);
});

test('inZone answers on the borders the way the halves say', () => {
  const zones = stringZones('ab"cd"ef', C_LIKE);
  assert.equal(inZone(zones, 1), false);
  assert.equal(inZone(zones, 2), true);
  assert.equal(inZone(zones, 5), true);
  assert.equal(inZone(zones, 6), false);
});

test('replaceWhitespaceOutsideStrings leaves zone interiors alone', () => {
  const collapse = (): string => '·';
  assert.equal(replaceWhitespaceOutsideStrings('a  "b  c"  d', C_LIKE, collapse), 'a·"b  c"·d');
  assert.equal(replaceWhitespaceOutsideStrings('a  b', C_LIKE, collapse), 'a·b');
});

test('the collapse callback gets offsets into the ORIGINAL text', () => {
  const seen: number[] = [];
  replaceWhitespaceOutsideStrings('ab  "x  y"  cd', C_LIKE, (ws, off) => {
    seen.push(off);
    return ws;
  });
  assert.deepEqual(seen, [2, 10]);
});
