import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter, normalize } from '../../src/lang/cpp/index.ts';
import { matchPattern } from '../../src/core/matcher.ts';
import { planEdit, applyEdit, patchHunk } from '../../src/core/patcher.ts';
import { firstMatch, wrapMatch } from '../helpers.ts';

function pattern(...lines: string[]) {
  return firstMatch(wrapMatch(lines.join('\n')));
}

test('planEdit: a pure insertion has start == end', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); b(); }';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a(); >>> ...'), map, normalize);
  const edit = planEdit(marks, map, 'X();');
  assert.equal(edit.start, edit.end);
  assert.equal(src[edit.start], ' ');
});

test('planEdit: a replacement puts end after start, spanning the old code', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a; >>> old(); <<< b; ...'), map, normalize);
  const edit = planEdit(marks, map, 'new();');
  assert.ok(edit.end > edit.start);
  assert.equal(src.slice(edit.start, edit.end).trim(), 'old();');
});

test('applyEdit: insertion and replacement give the expected string', () => {
  assert.equal(applyEdit('ab', { start: 1, end: 1, text: 'X' }), 'aXb');
  assert.equal(applyEdit('aOLDb', { start: 1, end: 4, text: 'X' }), 'aXb');
});

test('patchHunk: an insertion returns the new text and the edit', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); b(); }';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a(); >>> ...'), map, normalize);
  const { source, edit } = patchHunk(src, map, marks, 'X();');
  assert.ok(source.includes('a();X(); b();'), source);
  assert.equal(edit.start, edit.end);
});

test('patchHunk: a replacement cuts the old code out and puts the patch in', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const map = cppAdapter.buildMap(src);
  const marks = matchPattern(pattern('... a; >>> old(); <<< b; ...'), map, normalize);
  const { source } = patchHunk(src, map, marks, 'new();');
  assert.equal(source, 'a;new(); b;');
});
