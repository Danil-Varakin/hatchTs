import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffHunks, changeSegments, lineKind, lineText } from '../../src/generate/diff.ts';

test('идентичные файлы → ноль ханков и ноль сегментов', () => {
  const src = 'int a;\nint b;\nint c;\n';
  assert.deepEqual(diffHunks(src, src), []);
  assert.deepEqual(changeSegments(src, src), []);
});

test('одна изменённая строка: ханк несёт контекст, del и add', () => {
  const oldStr = 'a\nb\nc\nd\ne\n';
  const newStr = 'a\nb\nC\nd\ne\n';
  const hunks = diffHunks(oldStr, newStr);
  assert.equal(hunks.length, 1);
  const h = hunks[0]!;
  assert.equal(h.oldStart, 1);
  assert.ok(h.lines.includes('-c'));
  assert.ok(h.lines.includes('+C'));
  assert.ok(h.lines.includes(' b'));
  assert.ok(h.lines.includes(' d'));
});

test('context управляет шириной ханка и слиянием соседних правок', () => {
  const oldStr = 'a\nb\nc\nd\ne\nf\ng\n';
  const newStr = 'A\nb\nc\nd\ne\nf\nG\n';
  assert.equal(diffHunks(oldStr, newStr, 1).length, 2);
  assert.equal(diffHunks(oldStr, newStr, 5).length, 1);
});

test('lineKind/lineText: разбор префикс-маркеров, включая eofnl', () => {
  assert.equal(lineKind(' ctx'), 'context');
  assert.equal(lineKind('-gone'), 'del');
  assert.equal(lineKind('+new'), 'add');
  assert.equal(lineKind('\\ No newline at end of file'), 'eofnl');
  assert.equal(lineText('+result *= 2;'), 'result *= 2;');
  assert.equal(lineText('-old'), 'old');
});

// --- changeSegments: атомарные правки (один сегмент = один Hatch-ханк) ---

test('замена одной строки → один сегмент {removed, added} с координатами', () => {
  const oldStr = 'a\nb\nc\nd\ne\n';
  const newStr = 'a\nb\nC\nd\ne\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 3, newStart: 3, removed: ['c'], added: ['C'] });
});

test('чистая вставка: removed пуст, oldStart = строка, ПЕРЕД которой вставка', () => {
  const oldStr = 'a\nb\nc\n';
  const newStr = 'a\nX\nb\nc\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 2, newStart: 2, removed: [], added: ['X'] });
});

test('чистое удаление: added пуст', () => {
  const oldStr = 'a\nb\nc\n';
  const newStr = 'a\nc\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 2, newStart: 2, removed: ['b'], added: [] });
});

test('две правки, разделённые неизменёнными строками → ДВА сегмента', () => {
  const oldStr = 'a\nb\nc\nd\ne\nf\ng\n';
  const newStr = 'A\nb\nc\nd\ne\nf\nG\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { oldStart: 1, newStart: 1, removed: ['a'], added: ['A'] });
  assert.deepEqual(segs[1], { oldStart: 7, newStart: 7, removed: ['g'], added: ['G'] });
});

test('правки через ПУСТУЮ неизменённую строку сшиваются по умолчанию (пустая → в блок)', () => {
  const oldStr = 'a\n\nb\n';
  const newStr = 'A\n\nB\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 1, newStart: 1, removed: ['a', '', 'b'], added: ['A', '', 'B'] });
});

test('непустая неизменённая строка (bar();) по умолчанию РЕЖЕТ; bridgeGap=1 — сшивает', () => {
  const oldStr = 'foo();\nbar();\nbaz();\n';
  const newStr = 'foo2();\nbar();\nbaz2();\n';
  assert.equal(changeSegments(oldStr, newStr).length, 2);
  const merged = changeSegments(oldStr, newStr, 1);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], {
    oldStart: 1,
    newStart: 1,
    removed: ['foo();', 'bar();', 'baz();'],
    added: ['foo2();', 'bar();', 'baz2();'],
  });
});

test('многострочная замена подряд → ОДИН сегмент со всеми строками', () => {
  const oldStr = 'x\na\nb\ny\n';
  const newStr = 'x\nA\nB\nC\ny\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 2, newStart: 2, removed: ['a', 'b'], added: ['A', 'B', 'C'] });
});

test('вставка цельного блока = ОДНА вставка, НЕ построчно (пустая строка внутри — часть блока)', () => {
  const oldStr = 'a\nb\n';
  const newStr = 'a\nX1\nX2\n\nX4\nb\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { oldStart: 2, newStart: 2, removed: [], added: ['X1', 'X2', '', 'X4'] });
});

test('сегменты покрывают старый файл в порядке возрастания oldStart', () => {
  const oldStr = 'a\nb\nc\nd\ne\nf\ng\nh\n';
  const newStr = 'a\nB\nc\nd\nE\nf\ng\nH\n';
  const segs = changeSegments(oldStr, newStr);
  assert.equal(segs.length, 3);
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i]!.oldStart > segs[i - 1]!.oldStart);
});
