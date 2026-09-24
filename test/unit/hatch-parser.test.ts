import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { ParseError } from '../../src/core/errors.ts';
import { strip, firstMatch, wrapMatch, type FlatStep } from '../helpers.ts';

function lit(raw: string): FlatStep['anchor'] {
  return { kind: 'literal', raw };
}
const EOF: FlatStep['anchor'] = { kind: 'eof' };

function md(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

function expectParseError(text: string, msgPart?: string): ParseError {
  let thrown: unknown;
  try {
    parseHatchFile(text);
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ParseError, 'a ParseError was expected');
  const err = thrown as ParseError;
  assert.equal(err.exitCode, 2,'ParseError → exit code 2');
  assert.equal(typeof err.mdLine, 'number', 'ParseError has a line number');
  assert.ok(err.mdLine >= 1, 'line number 1-based');
  if (msgPart !== undefined) {
    assert.ok(
      err.message.includes(msgPart),
      `the message must contain "${msgPart}", received: ${err.message}`,
    );
  }
  return err;
}

test('insertion point at the end of the block → eof-step with insert=left', () => {
  const m = firstMatch(wrapMatch('#include "a.h"\n>>>'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('#include "a.h"') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: EOF },
  ]);
});

test('inline "foo >>> bar": insert between literals (side=left)', () => {
  const m = firstMatch(wrapMatch('foo >>> bar'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('foo') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('bar') },
  ]);
});

test('nested namespace: skipAny + closing "}" as literal', () => {
  const m = firstMatch(wrapMatch('namespace features {\n...\nkFoo,\n>>>\n}'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('namespace features {') },
    { mode: { op: 'skipAny' }, insert: null, replaceEnd: null, anchor: lit('kFoo,') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('}') },
  ]);
});

test('the replacement range is "A >>> ... <<< B": both labels on the same gap', () => {
  const m = firstMatch(wrapMatch('A >>> ... <<< B'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('A') },
    { mode: { op: 'skipAny' }, insert: 'left', replaceEnd: 'right', anchor: lit('B') },
  ]);
});

test('">>> A <<<": A is the old code (insert/replace=left on both sides of the literal)', () => {
  const m = firstMatch(wrapMatch('>>> A <<<'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('A') },
    { mode: { op: 'tight' }, insert: null, replaceEnd: 'left', anchor: EOF },
  ]);
});

test('insert at the end of the file "... >>>"', () => {
  const m = firstMatch(wrapMatch('... >>>'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'skipAny' }, insert: 'right', replaceEnd: null, anchor: EOF },
  ]);
});

test('insert at the beginning of the file ">>> foo"', () => {
  const m = firstMatch(wrapMatch('>>> foo'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('foo') },
  ]);
});

test('gluing: adjacent literals → ONE multiline literal', () => {
  const m = firstMatch(wrapMatch('line one\nline two\nline three\n>>>'));

  assert.deepStrictEqual(strip(m), [
    {
      mode: { op: 'tight' },
      insert: null,
      replaceEnd: null,
      anchor: lit('line one\nline two\nline three'),
    },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: EOF },
  ]);
});

test('gluing: mdSpan covers [First line, Last line]', () => {
  const m = firstMatch(wrapMatch('line one\nline two\nline three\n>>>'));
  const a = m.steps[0]!.anchor;
  assert.equal(a.target, 'literal');
  assert.deepStrictEqual(a.target === 'literal' ? a.literal.mdSpan : null, [2, 4]);
});

test('gluing does NOT occur via the operator (... breaks the adjacency)', () => {
  const m = firstMatch(wrapMatch('a\n...\nb\n>>>'));
  assert.equal(strip(m).length, 3);
  assert.equal(strip(m)[1]!.mode.op, 'skipAny');
});

test('Python:the leading indentation of the inner line is preserved in the glued raw', () => {
  const m = firstMatch(wrapMatch('def foo():\n    return None\n>>>', 'python'));
  assert.equal(strip(m)[0]!.anchor.raw, 'def foo():\n    return None');
  assert.equal(strip(m).length, 2);
});

test('include with a leading space: spaces are saved in raw', () => {
  const m = firstMatch(wrapMatch('  #include "x.h"\n>>>'));
  assert.equal(strip(m)[0]!.anchor.raw, '  #include "x.h"');
});

test('the escaped "\\..." becomes the literal "..." (not an operator)', () => {
  const m = firstMatch(wrapMatch('\\... >>> foo'));
  assert.equal(strip(m)[0]!.anchor.kind, 'literal');
  assert.equal(strip(m)[0]!.anchor.raw, '...');
});

test('"\\..." in the middle of a word stays as-is (escape is positional)', () => {
  const m = firstMatch(wrapMatch('foo\\...bar >>>'));
  assert.equal(strip(m)[0]!.anchor.raw, 'foo\\...bar');
});

test('standalone "\\\\..." loses exactly ONE backslash (escape of the escape)', () => {
  const m = firstMatch(wrapMatch('x \\\\... y >>>'));
  assert.equal(strip(m)[0]!.anchor.raw, 'x \\... y');
});

test('the language is determined by the "# match <lang>" heading', () => {
  const file = parseHatchFile(wrapMatch('foo >>>', 'cpp'));
  assert.equal(file.language, 'cpp');
});

test('a heading without a language is fine', () => {
  const file = parseHatchFile(md('# match', '    foo >>>', '# end', '# patch', '    X', '# end'));
  assert.equal(file.language, undefined);
  assert.equal(file.hunks.length, 1);
});

test('the same language in several headings is fine', () => {
  const text = [wrapMatch('foo >>>', 'cpp'), wrapMatch('bar >>>', 'cpp')].join('\n');
  assert.equal(parseHatchFile(text).language, 'cpp');
});

test('FAIL: mixed languages in one file', () => {
  const text = [wrapMatch('foo >>>', 'cpp'), wrapMatch('bar >>>', 'python')].join('\n');
  expectParseError(text, 'language');
});

test('FAIL: <<< without preceding >>>', () => {
  expectParseError(wrapMatch('foo\n<<<\n>>>'), 'end of range before start');
});

test('FAIL: repeat insertion point >>>', () => {
  expectParseError(wrapMatch('foo >>> bar >>> baz'), 'repeat insertion point');
});

test('FAIL: two skip operators in one gap (mark is transparent)', () => {
  expectParseError(wrapMatch('foo ... >>> ... bar'), 'two skip operators');
});

test('FAIL: two ... in a row are still two skips', () => {
  expectParseError(wrapMatch('foo ... ... bar >>>'), 'two skip operators');
});

test('FAIL: match block with no insertion point >>>', () => {
  expectParseError(wrapMatch('foo\nbar'), 'no insertion point');
});

test('FAIL: a body line without the four-space gutter', () => {
  expectParseError(md('# match', 'not indented', '# end'), 'must start with four spaces');
});

test('FAIL: match block not followed by a patch heading', () => {
  expectParseError(
    md('# match', '    foo >>>', '# end', 'garbage instead of patch'),
    'patch header is expected',
  );
});

test('FAIL: file truncated mid-block ("# end" is missing)', () => {
  expectParseError(md('# match', '    foo >>>'), 'not closed');
});

test('FAIL: a heading where "# end" was expected', () => {
  expectParseError(md('# match', '    foo >>>', '# patch', '    X', '# end'), 'not closed');
});

test('FAIL: file has no match/patch pairs at all', () => {
  expectParseError('just text, no hatch here\n', 'no match/patch pairs');
});

test('FAIL: text between hunks', () => {
  expectParseError(
    wrapMatch('foo >>>') + '\nstray commentary\n' + wrapMatch('bar >>>'),
    'text between hunks',
  );
});

test('FAIL: the old fenced format is reported by name, with the fix in the hint', () => {
  const err = expectParseError(
    md('# match', '```cpp', 'foo >>>', '```', '# patch', '```cpp', 'X', '```'),
    'fenced format is no longer supported',
  );
  assert.match(err.hint ?? '', /four spaces/);
  assert.match(err.hint ?? '', /# end/);
});

// ── the gutter: column 0 belongs to the structure, payload never reaches it ───

test('a fence inside the patch body survives verbatim', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end',
       '# patch', '    ```cpp', '    int sample = 1;', '    ```', '# end'),
  );
  assert.equal(file.hunks[0]!.patch, '```cpp\nint sample = 1;\n```');
});

test('a bare fence inside the match block is an ordinary literal', () => {
  const m = firstMatch(md('# match cpp', '    ```', '    >>>', '# end',
                          '# patch', '    X', '# end'));
  assert.deepStrictEqual(strip(m)[0]!.anchor, { kind: 'literal', raw: '```' });
});

test('"# patch" and "# end" inside the payload are payload, not structure', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end',
       '# patch', '    # patch', '    # end', '# end'),
  );
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0]!.patch, '# patch\n# end');
});

test('blank lines in the patch body are kept, trailing ones included', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end',
       '# patch', '    a();', '', '    b();', '', '# end'),
  );
  assert.equal(file.hunks[0]!.patch, 'a();\n\nb();\n');
});

test('a patch body of blank lines only', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end', '# patch', '', '', '# end'),
  );
  assert.equal(file.hunks[0]!.patch, '\n');
});

test('an empty patch body is a deletion', () => {
  const file = parseHatchFile(md('# match cpp', '    foo >>>', '# end', '# patch', '# end'));
  assert.equal(file.hunks[0]!.patch, '');
});

test('a payload line of four spaces is an empty payload line, not a blank', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end', '# patch', '    a();', '    ', '# end'),
  );
  assert.equal(file.hunks[0]!.patch, 'a();\n');
});

test('the gutter is stripped exactly: deeper indentation is preserved', () => {
  const file = parseHatchFile(
    md('# match cpp', '    foo >>>', '# end', '# patch', '        deep();', '# end'),
  );
  assert.equal(file.hunks[0]!.patch, '    deep();');
});

test('prose before the first "# match" is ignored', () => {
  const prose = 'Instructions for foo.cc.\n\nAny text at all, even ``` and # end.\n\n';
  assert.equal(parseHatchFile(prose + wrapMatch('foo >>>')).hunks.length, 1);
});

test('mdSpan of a hunk spans the "# match" heading and the closing "# end"', () => {
  const file = parseHatchFile(md('# match cpp', '    foo >>>', '# end', '# patch', '    X', '# end'));
  assert.deepStrictEqual(file.hunks[0]!.mdSpan, [1, 6]);
});
