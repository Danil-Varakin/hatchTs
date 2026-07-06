// ============================================================================
// test/unit/parser.test.ts — постоянные тесты ядра-парсера (фаза 1).
// Запуск: node --test --experimental-strip-types test/unit/parser.test.ts
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/parser.ts';
import { ParseError } from '../../src/core/errors.ts';
import { strip, firstMatch, wrapMatch, type FlatStep } from '../helpers.ts';

// ── helpers ────────────────────────────────────────────────────────────────

function lit(raw: string): FlatStep['anchor'] {
  return { kind: 'literal', raw };
}
const EOF: FlatStep['anchor'] = { kind: 'eof' };

/** Утверждение: разбор md бросает ParseError с кодом 2 и номером строки. */
function expectParseError(md: string, msgPart?: string): ParseError {
  let thrown: unknown;
  try {
    parseHatchFile(md);
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ParseError, 'ожидался ParseError');
  const err = thrown as ParseError;
  assert.equal(err.exitCode, 2, 'ParseError → код выхода 2');
  assert.equal(typeof err.mdLine, 'number', 'у ParseError есть номер строки');
  assert.ok(err.mdLine >= 1, 'номер строки 1-based');
  if (msgPart !== undefined) {
    assert.ok(
      err.message.includes(msgPart),
      `сообщение должно содержать «${msgPart}», получено: ${err.message}`,
    );
  }
  return err;
}

// ── валидные паттерны: структура AST ─────────────────────────────────────────

test('точка вставки в конце блока → eof-шаг с insert=left', () => {
  const m = firstMatch(wrapMatch('#include "a.h"\n>>>'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('#include "a.h"') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: EOF },
  ]);
});

test('инлайн «foo >>> bar»: вставка между литералами (side=left)', () => {
  const m = firstMatch(wrapMatch('foo >>> bar'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('foo') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('bar') },
  ]);
});

test('вложенный namespace: skipAny + закрывающая «}» как литерал', () => {
  const m = firstMatch(wrapMatch('namespace features {\n...\nkFoo,\n>>>\n}'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('namespace features {') },
    { mode: { op: 'skipAny' }, insert: null, replaceEnd: null, anchor: lit('kFoo,') },
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('}') },
  ]);
});

test('диапазон замены «A >>> ... <<< B»: обе метки на одном зазоре', () => {
  const m = firstMatch(wrapMatch('A >>> ... <<< B'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: null, replaceEnd: null, anchor: lit('A') },
    { mode: { op: 'skipAny' }, insert: 'left', replaceEnd: 'right', anchor: lit('B') },
  ]);
});

test('«>>> A <<<»: A — старый код (insert/replaceEnd=left по обе стороны литерала)', () => {
  const m = firstMatch(wrapMatch('>>> A <<<'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('A') },
    { mode: { op: 'tight' }, insert: null, replaceEnd: 'left', anchor: EOF },
  ]);
});

test('операторы пропуска: ^.. → skipToFirst', () => {
  const m = firstMatch(wrapMatch('^.. foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToFirst' });
});

test('операторы пропуска: ..^ → skipToLast', () => {
  const m = firstMatch(wrapMatch('..^ foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToLast' });
});

test('операторы пропуска: ^3.. → skipToNth n=3 (1-based)', () => {
  const m = firstMatch(wrapMatch('^3.. foo >>>'));
  assert.deepStrictEqual(strip(m)[0]!.mode, { op: 'skipToNth', n: 3 });
});

test('вставка в конец файла «... >>>»', () => {
  const m = firstMatch(wrapMatch('... >>>'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'skipAny' }, insert: 'right', replaceEnd: null, anchor: EOF },
  ]);
});

test('вставка в начало файла «>>> foo»', () => {
  const m = firstMatch(wrapMatch('>>> foo'));
  assert.deepStrictEqual(strip(m), [
    { mode: { op: 'tight' }, insert: 'left', replaceEnd: null, anchor: lit('foo') },
  ]);
});

// ── ведущие пробелы сохраняются в raw (нужно Python-адаптеру) ─────────────────

test('склейка: смежные литералы → ОДИН многострочный литерал', () => {
  const m = firstMatch(wrapMatch('line one\nline two\nline three\n>>>'));
  // три строки подряд без оператора между ними склеились в один литерал,
  // дальше — eof-шаг с точкой вставки. Итого 2 шага, не 4.
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

test('склейка: mdSpan покрывает [перваяСтрока, последняяСтрока]', () => {
  // строки .md:  1:# match 2:```cpp 3:line one 4:line two 5:line three 6:>>> ...
  const m = firstMatch(wrapMatch('line one\nline two\nline three\n>>>'));
  const a = m.steps[0]!.anchor;
  assert.equal(a.target, 'literal');
  assert.deepStrictEqual(a.target === 'literal' ? a.literal.mdSpan : null, [3, 5]);
});

test('склейка НЕ происходит через оператор (... разрывает смежность)', () => {
  // между литералами есть ..., значит зазор не «чистый tight» — два отдельных шага
  const m = firstMatch(wrapMatch('a\n...\nb\n>>>'));
  assert.equal(strip(m).length, 3); // a | b(skipAny) | eof(insert)
  assert.equal(strip(m)[1]!.mode.op, 'skipAny');
});

test('Python: ведущий отступ внутренней строки сохранён в склеенном raw', () => {
  const m = firstMatch(wrapMatch('def foo():\n    return None\n>>>', 'python'));
  // склейка языко-нейтральна: парсер лишь джойнит через \n, отступ строки цел
  assert.equal(strip(m)[0]!.anchor.raw, 'def foo():\n    return None');
  assert.equal(strip(m).length, 2);
});

test('include с ведущим пробелом: пробелы сохранены в raw', () => {
  const m = firstMatch(wrapMatch('  #include "x.h"\n>>>'));
  assert.equal(strip(m)[0]!.anchor.raw, '  #include "x.h"');
});

test('экранированный «\\...» становится литералом «...» (не оператором)', () => {
  const m = firstMatch(wrapMatch('\\... >>> foo'));
  assert.equal(strip(m)[0]!.anchor.kind, 'literal');
  assert.equal(strip(m)[0]!.anchor.raw, '...');
});

// ── язык берётся из fence ────────────────────────────────────────────────────

test('язык определяется по info-string первого fence', () => {
  const file = parseHatchFile(wrapMatch('foo >>>', 'cpp'));
  assert.equal(file.language, 'cpp');
});

// ── запрещённые комбинации → ParseError, код 2 ───────────────────────────────

test('FAIL: <<< без предшествующего >>>', () => {
  expectParseError(wrapMatch('foo\n<<<\n>>>'), 'конец диапазона раньше начала');
});

test('FAIL: повторная точка вставки >>>', () => {
  expectParseError(wrapMatch('foo >>> bar >>> baz'), 'повторная точка вставки');
});

test('FAIL: два оператора пропуска в одном зазоре (метка прозрачна)', () => {
  expectParseError(wrapMatch('foo ... >>> ... bar'), 'два оператора пропуска');
});

test('FAIL: ^.. сразу после ... — тоже два пропуска', () => {
  expectParseError(wrapMatch('foo ... ^.. bar >>>'), 'два оператора пропуска');
});

test('FAIL: некорректный номер вхождения ^0..', () => {
  expectParseError(wrapMatch('^0.. foo >>>'), 'некорректный номер');
});

test('FAIL: блок match без точки вставки >>>', () => {
  expectParseError(wrapMatch('foo\nbar'), 'нет точки вставки');
});

test('FAIL: после заголовка match нет блока ```', () => {
  expectParseError('# match\nне fence строка\n', 'ожидается блок');
});

test('FAIL: после блока match нет заголовка patch', () => {
  const md = '# match\n```cpp\nfoo >>>\n```\nмусор вместо patch\n';
  expectParseError(md, 'ожидается заголовок patch');
});

test('FAIL: файл оборван посреди блока', () => {
  expectParseError('# match\n```cpp\nfoo >>>\n```\n', 'оборван');
});

test('FAIL: в файле нет ни одной пары match/patch', () => {
  expectParseError('просто текст без хатча\n', 'ни одной пары');
});