import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter, normalize } from '../../src/lang/cpp/index.ts';
import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { matchPattern } from '../../src/core/matcher.ts';
import { planEdit, applyEdit, patchHunk } from '../../src/core/patcher.ts';

function pattern(...lines: string[]) {
  const md = ['# match', '```cpp', ...lines, '```', '# patch', '```cpp', 'X', '```'].join('\n');
  return parseHatchFile(md).hunks[0]!.match;
}

test('planEdit: чистая вставка — start == end', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); b(); }';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a(); >>> ...'), map, normalize);
  const edit = planEdit(marks, map, 'X();');
  assert.equal(edit.start, edit.end); // вставка
  assert.equal(src[edit.start], ' '); // сразу после a();
});

test('planEdit: замена — end после start, span покрывает старый код', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a; >>> old(); <<< b; ...'), map, normalize);
  const edit = planEdit(marks, map, 'new();');
  assert.ok(edit.end > edit.start);
  assert.equal(src.slice(edit.start, edit.end).trim(), 'old();');
});

test('applyEdit: вставка и замена дают ожидаемую строку', () => {
  assert.equal(applyEdit('ab', { start: 1, end: 1, text: 'X' }), 'aXb'); // вставка
  assert.equal(applyEdit('aOLDb', { start: 1, end: 4, text: 'X' }), 'aXb'); // замена
});

test('patchHunk: вставка — новый текст и правка', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); b(); }';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a(); >>> ...'), map, normalize);
  const { source, edit } = patchHunk(src, map, marks, 'X();');
  assert.ok(source.includes('a();X(); b();'), source);
  assert.equal(edit.start, edit.end);
});

test('patchHunk: замена — вырезает старый код, ставит патч', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a; >>> old(); <<< b; ...'), map, normalize);
  const { source } = patchHunk(src, map, marks, 'new();');
  assert.equal(source, 'a;new(); b;');
});
