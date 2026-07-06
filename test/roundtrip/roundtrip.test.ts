import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strip, firstMatch, wrapMatch, roundtrip } from '../helpers.ts';

const CASES: ReadonlyArray<readonly [name: string, body: string, lang?: string]> = [
  ['simple insertion after a literal', '#include "a.h"\n>>>'],
  ['inline insertion between literals', 'foo >>> bar'],
  ['nested namespace + skipAny + }', 'namespace features {\n...\nkFoo,\n>>>\n}'],
  ['multiline literal (gluing adjacent lines)', 'a\nb\nc\n>>>'],
  ['multi-line with indents (Python)', 'def f():\n    x = 1\n    y = 2\n>>>', 'python'],
  ['replacement range A >>> ... <<< B', 'A >>> ... <<< B'],
  ['old code >>> A <<<', '>>> A <<<'],
  ['empty range >>> <<<', '>>> <<<'],
  ['skipToFirst ^..', '^.. foo >>>'],
  ['skipToLast ..^', '..^ foo >>>'],
  ['skipToNth ^3..', '^3.. foo >>>'],
  ['paste at the end of the file ... >>>', '... >>>'],
  ['inserting at the beginning of the file >>> foo', '>>> foo'],
  ['Python indented in raw', 'def foo():\n    return None\n>>>', 'python'],
  ['include with a leading space', '  #include "x.h"\n>>>'],
];

for (const [name, body, lang] of CASES) {
  test(`round-trip: ${name}`, () => {
    const original = firstMatch(wrapMatch(body, lang ?? 'cpp'));
    const reparsed = roundtrip(original, lang ?? 'cpp');
    assert.deepStrictEqual(strip(reparsed), strip(original));
  });
}

test('round-trip стабилен при двойном прогоне', () => {
  const original = firstMatch(wrapMatch('namespace N {\n...\n>>>\n}'));
  const once = roundtrip(original);
  const twice = roundtrip(once);
  assert.deepStrictEqual(strip(twice), strip(once));
});


for (const [name, body] of [
  ['a separate "..." as a literal', '\\... >>> foo'],
  ['the operator in the middle of the literal', 'a \\... b >>>'],
  ['the escaped operator inside the gluing', 'a\n\\... \nb\n>>>'],
  ['several screened ones in a row', '\\>>> \\<<< >>> x'],
  ['shielded ^2..', '\\^2.. foo >>>'],
] as const) {
  test(`round-trip (screening): ${name}`, () => {
    const original = firstMatch(wrapMatch(body));
    const reparsed = roundtrip(original);
    assert.deepStrictEqual(strip(reparsed), strip(original));
  });
}