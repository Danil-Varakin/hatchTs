import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { ParseError } from '../../src/core/errors.ts';
import { strip, firstMatch, wrapMatch, type FlatStep } from '../helpers.ts';


function lit(raw: string): FlatStep['anchor'] {
  return { kind: 'literal', raw };
}
const EOF: FlatStep['anchor'] = { kind: 'eof' };

function expectParseError(md: string, msgPart?: string): ParseError {
  let thrown: unknown;
  try {
    parseHatchFile(md);
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

test('skip operators: ^.. → skipToFirst', () => {
  const m = firstMatch(wrapMatch('^.. foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToFirst' });
});

test('skip operators: ..^ → skipToLast', () => {
  const m = firstMatch(wrapMatch('..^ foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToLast' });
});

test('skip operators: ^3.. → skipToNth n=3 (1-based)', () => {
  const m = firstMatch(wrapMatch('^3.. foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToNth', n: 3 });
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
  assert.deepStrictEqual(a.target === 'literal' ? a.literal.mdSpan : null, [3, 5]);
});

test('gluing does NOT occur via the operator (... breaks the adjacency)', () => {
  const m = firstMatch(wrapMatch('a\n...\nb\n>>>'));
  assert.equal(strip(m).length, 3); // a | b(skipAny) | eof(insert)
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


test('the language is determined by the info string of the first fence', () => {
  const file = parseHatchFile(wrapMatch('foo >>>', 'cpp'));
  assert.equal(file.language, 'cpp');
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

test('FAIL: ^.. right after ... — also two skips', () => {
  expectParseError(wrapMatch('foo ... ^.. bar >>>'), 'two skip operators');
});

test('FAIL: invalid occurrence number ^0..', () => {
  expectParseError(wrapMatch('^0.. foo >>>'), 'invalid occurrence number');
});

test('FAIL: match block with no insertion point >>>', () => {
  expectParseError(wrapMatch('foo\nbar'), 'no insertion point');
});

test('FAIL: match heading not followed by a ``` block', () => {
  expectParseError('# match\nnot a fence line\n', 'block is expected');
});

test('FAIL: match block not followed by a patch heading', () => {
  const md = '# match\n```cpp\nfoo >>>\n```\ngarbage instead of patch\n';
  expectParseError(md, 'patch header is expected');
});

test('FAIL: file truncated mid-block', () => {
  expectParseError('# match\n```cpp\nfoo >>>\n```\n', 'cut off');
});

test('FAIL: file has no match/patch pairs at all', () => {
  expectParseError('just text, no hatch here\n', 'no match/patch pairs');
});