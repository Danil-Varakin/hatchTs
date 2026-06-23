// ============================================================================
// test/unit/python/normalize.test.ts — канон литерала по правилам Python.
// Асимметрия с C++: ведущий отступ строки СОХРАНЯЕТСЯ (маркер уровня), тело
// чистится теми же правилами. Нормализуется ПОСТРОЧНО, строки склеиваются \n.
// (00-general-rules §4; phase-5.)
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/python/normalize.ts';

test('ведущий отступ строки СОХРАНЯЕТСЯ', () => {
  assert.equal(normalize('    return None'), '    return None');
  assert.equal(normalize('\tx = 1'), '\tx=1'); // таб как 1 символ (phase-5)
});

test('РАЗНЫЙ отступ → РАЗНЫЙ канон (в отличие от C++)', () => {
  assert.notEqual(normalize('  a'), normalize('    a'));
});

test('тело строки чистится как в C-подобных', () => {
  assert.equal(normalize('def  foo():'), 'def foo():'); // двойной пробел → один
  assert.equal(normalize('    x = 1'), '    x=1'); // пробел у пунктуации — прочь
  assert.equal(normalize('    a  +  b'), '    a+b');
});

test('значимый зазор между словами в теле схлопывается, но не теряется', () => {
  assert.equal(normalize('    return  None'), '    return None');
  assert.notEqual(normalize('return None'), normalize('returnNone'));
});

test('многострочный литерал: построчно + склейка через \\n (\\n значим)', () => {
  assert.equal(
    normalize('def foo():\n    return None'),
    'def foo():\n    return None',
  );
  // внутренние отступы каждой строки сохранены
  assert.equal(
    normalize('def f():\n    if x:\n        y = 1'),
    'def f():\n    if x:\n        y=1',
  );
});

test('идемпотентность', () => {
  for (const s of ['    x = 1', 'def  foo():', 'def f():\n    return None']) {
    assert.equal(normalize(normalize(s)), normalize(s));
  }
});