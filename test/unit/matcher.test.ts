import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cppAdapter, normalize } from '../../src/lang/cpp/index.ts';
import { matchPattern } from '../../src/core/matcher.ts';
import type { MatchMarks } from '../../src/core/matcher.ts';
import type { MatchPattern } from '../../src/core/ast.ts';
import { MatchError, AmbiguityError } from '../../src/core/errors.ts';
import { firstMatch, wrapMatch } from '../helpers.ts';

// ── помощники ─────────────────────────────────────────────────────────────────

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

// ── края файла: BOF / EOF ─────────────────────────────────────────────────────

test('... >>> — вставка в конец файла (EOF)', async () => {
  await cppAdapter.init();
  const src = 'int x = 1;';
  const marks = run(src, pattern('... >>>'));
  assert.equal(apply(src, marks, '\nint y = 2;'), 'int x = 1;\nint y = 2;');
});

test('>>> ... — вставка в начало файла (BOF)', async () => {
  await cppAdapter.init();
  const src = 'int x = 1;';
  const marks = run(src, pattern('>>> ...'));
  assert.equal(apply(src, marks, '#include "a.h"\n'), '#include "a.h"\nint x = 1;');
});

// ── якорь + вставка до/после ──────────────────────────────────────────────────

test('... foo(); >>> ... — вставка сразу после найденного якоря', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); bar(); }';
  const marks = run(src, pattern('... foo(); >>> ...'));
  assert.equal(apply(src, marks, ' baz();'), 'void f(){ foo(); baz(); bar(); }');
});

test('... >>> bar(); ... — вставка прямо перед найденным якорем', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); bar(); }';
  const marks = run(src, pattern('... >>> bar(); ...'));
  assert.equal(apply(src, marks, 'baz(); '), 'void f(){ foo(); baz(); bar(); }');
});

// ── незакрытая { упорядочивает: контекст блока ────────────────────────────────

test('главный контрпример §3.1: ... func(...){ ... if(...){ ... >>> } ... } ...', async () => {
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

test('побег: ... func(...){ ... if(...){ ... >>> } ... — if в другой функции после func', async () => {
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

test('шаблон ЗАКРЫВАЕТ func: if в другой функции → MatchError (не сматчить чужой блок)', async () => {
  await cppAdapter.init();
  const src = [
    'void func(int a) {',
    '  // никакого if здесь нет',
    '}',
    '',
    'void CriticalShutdown() {',
    '  if (danger) {',
    '    // ← сюда прилетит вставка',
    '  }',
    '}',
  ].join('\n');
  assert.throws(
    () => run(src, pattern('... func( ... ) { ... if( ... ) { ... >>> } ... } ...')),
    MatchError,
  );
});

test('if И внутри, И после func → AmbiguityError', async () => {
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

// ── нет хвостового ... → последний литерал обязан упереться в EOF ──────────────

test('нет хвостового ...: якорь обязан быть в конце файла', async () => {
  await cppAdapter.init();
  const pat = pattern('... a(); >>> b();');
  const ok = 'a(); b();';
  assert.equal(apply(ok, run(ok, pat), 'X'), 'a();X b();');
  assert.throws(() => run('a(); b(); c();', pat), MatchError);
});

// ── замена диапазона >>> ... <<< ──────────────────────────────────────────────

test('замена диапазона: ... a; >>> old(); <<< b; ...', async () => {
  await cppAdapter.init();
  const src = 'a; old(); b;';
  const marks = run(src, pattern('... a; >>> old(); <<< b; ...'));
  assert.ok(marks.replaceEnd !== undefined);
  assert.equal(apply(src, marks, 'new();'), 'a;new(); b;');
});

// ── диагностика отказа и неоднозначности ──────────────────────────────────────

test('нет совпадения → MatchError', async () => {
  await cppAdapter.init();
  const src = 'void f(){ foo(); }';
  assert.throws(() => run(src, pattern('... nonexistent(); >>> ...')), MatchError);
});

test('два одинаковых якоря → AmbiguityError с позициями', async () => {
  await cppAdapter.init();
  const src = 'void f(){ ping(); ping(); }';
  try {
    run(src, pattern('... ping(); >>> ...'));
    assert.fail('ожидался AmbiguityError');
  } catch (e) {
    assert.ok(e instanceof AmbiguityError);
    assert.equal(e.positions.length, 2);
  }
});

// ── обязательное: `... }` детерминирован через обязательство ───────────────────

test('... >>> } берёт закрывашку своего блока (обязательство), не чужую', async () => {
  await cppAdapter.init();
  const src = 'void f(){ a(); } void g(){ b(); }';
  const marks = run(src, pattern('... f() { ... >>> }  ...'));
  const ins = insAt(src, marks);
  assert.equal(src[ins], '}');
  assert.ok(src.slice(0, ins).trimEnd().endsWith('a();'));
  assert.ok(src.slice(0, ins).indexOf('b()') === -1);
});
