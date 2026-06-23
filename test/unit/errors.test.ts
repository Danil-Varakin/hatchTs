import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HatchError,
  ParseError,
  MatchError,
  AmbiguityError,
  AlreadyAppliedError,
} from '../../src/core/errors.ts';

test('ParseError → код 2, несёт строку и (опц.) подсказку', () => {
  const e = new ParseError('боль', 7, 'совет');
  assert.ok(e instanceof HatchError);
  assert.equal(e.exitCode, 2);
  assert.equal(e.mdLine, 7);
  assert.equal(e.hint, 'совет');
  assert.ok(e.message.includes('строка 7'));
  assert.ok(e.message.includes('совет'));
});

test('ParseError без подсказки не выставляет hint', () => {
  const e = new ParseError('боль', 3);
  assert.equal(e.hint, undefined);
  assert.ok(!e.message.includes('подсказка'));
});

test('MatchError → код 3, несёт deepestPos и индекс шага', () => {
  const e = new MatchError('не нашёл', 42, 1);
  assert.equal(e.exitCode, 3);
  assert.equal(e.deepestPos, 42);
  assert.equal(e.failedStepIndex, 1);
});

test('AmbiguityError → код 4, несёт позиции совпадений', () => {
  const e = new AmbiguityError('двусмысленно', [10, 99]);
  assert.equal(e.exitCode, 4);
  assert.deepStrictEqual(e.positions, [10, 99]);
});

test('AlreadyAppliedError → код 5', () => {
  const e = new AlreadyAppliedError('уже наложен');
  assert.equal(e.exitCode, 5);
});

test('имена классов сохраняются (instanceof через цепочку прототипов)', () => {
  const e: HatchError = new ParseError('x', 1);
  assert.equal(e.name, 'ParseError');
  assert.ok(e instanceof Error);
});
