import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HatchError,
  ParseError,
  MatchError,
  AmbiguityError,
  AlreadyAppliedError,
} from '../../src/core/errors.ts';

test('ParseError → code 2, carries a string and (optional) a hint', () => {
  const e = new ParseError('pain', 7, 'advice');
  assert.ok(e instanceof HatchError);
  assert.equal(e.exitCode, 2);
  assert.equal(e.mdLine, 7);
  assert.equal(e.hint, 'advice');
  assert.ok(e.message.includes('string 7'));
  assert.ok(e.message.includes('advice'));
});

test('ParseError does not set a hint without a hint', () => {
  const e = new ParseError('pain', 3);
  assert.equal(e.hint, undefined);
  assert.ok(!e.message.includes('hint'));
});

test('MatchError → code 3, carries deepestPos and step index', () => {
  const e = new MatchError('I didn\'t find it', 42, 1);
  assert.equal(e.exitCode, 3);
  assert.equal(e.deepestPos, 42);
  assert.equal(e.failedStepIndex, 1);
});

test('AmbiguityError → code 4, carries match positions', () => {
  const e = new AmbiguityError('ambiguous', [10, 99]);
  assert.equal(e.exitCode, 4);
  assert.deepStrictEqual(e.positions, [10, 99]);
});

test('AlreadyAppliedError → code 5', () => {
  const e = new AlreadyAppliedError('already applied');
  assert.equal(e.exitCode, 5);
});

test('class names are saved (instanceof via prototype chain)', () => {
  const e: HatchError = new ParseError('x', 1);
  assert.equal(e.name, 'ParseError');
  assert.ok(e instanceof Error);
});
