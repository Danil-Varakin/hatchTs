import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter, normalize } from '../../src/lang/cpp/index.ts';
import { matchPattern } from '../../src/core/matcher.ts';
import type { MatchMarks } from '../../src/core/matcher.ts';
import type { MatchPattern } from '../../src/core/ast.ts';
import { MatchError, AmbiguityError } from '../../src/core/errors.ts';
import { firstMatch, wrapMatch } from '../helpers.ts';

// ── helpers ───────────────────────────────────────────────────────────────────

function pattern(...matchLines: string[]): MatchPattern {
  return firstMatch(wrapMatch(matchLines.join('\n')));
}

function apply(src: string, marks: MatchMarks, text: string): string {
  const map = cppAdapter.buildMap(src);
  const ins = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  if (marks.replaceEnd === undefined) {
    return src.slice(0, ins) + text + src.slice(ins);
  }
  const end = map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  return src.slice(0, ins) + text + src.slice(end);
}

function run(src: string, pat: MatchPattern): MatchMarks {
  const map = cppAdapter.buildMap(src);
  return matchPattern(pat, map, normalize);
}

function insAt(src: string, marks: MatchMarks): number {
  const map = cppAdapter.buildMap(src);
  return map.toOriginalPos(marks.insert.pos, marks.insert.side);
}

// ── the edges of the file: BOF / EOF ──────────────────────────────────────────

test('... >>> inserts at the end of the file (EOF)', async () => {
  await cppAdapter.init();
  const src = 'int x = 1;';
  const marks = run(src, pattern('... >>>'));
  assert.equal(apply(src, marks, '\nint y = 2;'), 'int x = 1;\nint y = 2;');
});

test('>>> ... inserts at the start of the file (BOF)', async () => {
  await cppAdapter.init();
  const src = 'int x = 1;';
  const marks = run(src, pattern('>>> ...'));
  assert.equal(apply(src, marks, '#include "a.h"\n'), '#include "a.h"\nint x = 1;');
});

// ── an anchor with the insertion before or after it ───────────────────────────

test('... foo(); >>> ... inserts right after the anchor it found', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); bar(); }';
  const marks = run(src, pattern('... foo(); >>> ...'));
  assert.equal(apply(src, marks, ' baz();'), 'void f(){ foo(); baz(); bar(); }');
});

test('... >>> bar(); ... inserts right before the anchor it found', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); bar(); }';
  const marks = run(src, pattern('... >>> bar(); ...'));
  assert.equal(apply(src, marks, 'baz(); '), 'void f(){ foo(); baz(); bar(); }');
});

// ── an unclosed { orders the search: the context of a block ───────────────────

test('the counterexample of §3.1: ... func(...){ ... if(...){ ... >>> } ... } ...', async () => {
  await cppAdapter.init();
  const src = [
    'void func(int a) {',
    '  for (;;) {',
    '    switch (a) {',
    '      case 1: {',
    '        if (a > 0) {',
    '          doWork();',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const marks = run(src, pattern('... func( ... ) { ... if( ... ) { ... >>> } ... } ...'));
  const ins = insAt(src, marks);
  assert.equal(src[ins], '}');
  assert.ok(src.slice(0, ins).trimEnd().endsWith('doWork();'), src.slice(0, ins).slice(-20));
});

test('escape: ... func(...){ ... if(...){ ... >>> } ... — an if in a later function', async () => {
  await cppAdapter.init();
  const src = [
    'void func(int a) {',
    '  prepare(a);',
    '}',
    'void handler(int b) {',
    '  if (b > 0) {',
    '    fallback();',
    '  }',
    '}',
  ].join('\n');
  const marks = run(src, pattern('... func( ... ) { ... if( ... ) { ... >>> } ...'));
  const ins = insAt(src, marks);
  assert.equal(src[ins], '}');
  assert.ok(src.slice(0, ins).trimEnd().endsWith('fallback();'), src.slice(0, ins).slice(-20));
});

test('the pattern CLOSES func: an if in another function is a MatchError', async () => {
  await cppAdapter.init();
  const src = [
    'void func(int a) {',
    '  // no if in here',
    '}',
    '',
    'void CriticalShutdown() {',
    '  if (danger) {',
    '    // ← the insertion lands here',
    '  }',
    '}',
  ].join('\n');
  assert.throws(
    () => run(src, pattern('... func( ... ) { ... if( ... ) { ... >>> } ... } ...')),
    MatchError,
  );
});

test('an if both inside and after func is an AmbiguityError', async () => {
  await cppAdapter.init();
  const src = [
    'void func(int a) {',
    '  if (a > 0) {',
    '    inside();',
    '  }',
    '}',
    'void handler(int b) {',
    '  if (b > 0) {',
    '    outside();',
    '  }',
    '}',
  ].join('\n');
  assert.throws(
    () => run(src, pattern('... func( ... ) { ... if( ... ) { ... >>> } ...')),
    AmbiguityError,
  );
});

// ── no trailing ... means the last literal must reach EOF ─────────────────────

test('without a trailing ... the anchor has to sit at the end of the file', async () => {
  await cppAdapter.init();
  const pat = pattern('... a(); >>> b();');
  const ok = 'a(); b();';
  assert.equal(apply(ok, run(ok, pat), 'X'), 'a();X b();');
  assert.throws(() => run('a(); b(); c();', pat), MatchError);
});

// ── replacing a range: >>> ... <<< ────────────────────────────────────────────

test('replacing a range: ... a; >>> old(); <<< b; ...', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const marks = run(src, pattern('... a; >>> old(); <<< b; ...'));
  assert.ok(marks.replaceEnd !== undefined);
  assert.equal(apply(src, marks, 'new();'), 'a;new(); b;');
});

// ── what a refusal and an ambiguity report ────────────────────────────────────

test('no match is a MatchError', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); }';
  assert.throws(() => run(src, pattern('... nonexistent(); >>> ...')), MatchError);
});

test('two identical anchors give an AmbiguityError carrying both places', async () => {
  await cppAdapter.init();
  const src = 'void f(){ ping(); ping(); }';
  try {
    run(src, pattern('... ping(); >>> ...'));
    assert.fail('expected an AmbiguityError');
  } catch (e) {
    assert.ok(e instanceof AmbiguityError);
    assert.equal(e.positions.length, 2);
  }
});

// ── the commitment: `... }` is decided by the block the pattern opened ────────

test('... >>> } takes the closer of its own block, never someone else\'s', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); } void g(){ b(); }';
  const marks = run(src, pattern('... f() { ... >>> }  ...'));
  const ins = insAt(src, marks);
  assert.equal(src[ins], '}');
  assert.ok(src.slice(0, ins).trimEnd().endsWith('a();'));
  assert.ok(src.slice(0, ins).indexOf('b()') === -1);
});
