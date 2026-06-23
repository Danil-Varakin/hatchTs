// ============================================================================
// test/roundtrip/roundtrip.test.ts — инвариант §6: parse(print(ast)) ≡ ast.
// Сравнение структурное (strip игнорирует mdLine).
// Запуск: node --test --experimental-strip-types test/roundtrip/roundtrip.test.ts
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strip, firstMatch, wrapMatch, roundtrip } from '../helpers.ts';

// Каждое тело match-блока содержит ровно один >>> (требование finish()).
const CASES: ReadonlyArray<readonly [name: string, body: string, lang?: string]> = [
  ['простая вставка после литерала', '#include "a.h"\n>>>'],
  ['инлайн вставка между литералами', 'foo >>> bar'],
  ['вложенный namespace + skipAny + }', 'namespace features {\n...\nkFoo,\n>>>\n}'],
  ['многострочный литерал (склейка смежных строк)', 'a\nb\nc\n>>>'],
  ['многострочный с отступами (Python)', 'def f():\n    x = 1\n    y = 2\n>>>', 'python'],
  ['диапазон замены A >>> ... <<< B', 'A >>> ... <<< B'],
  ['старый код >>> A <<<', '>>> A <<<'],
  ['пустой диапазон >>> <<<', '>>> <<<'],
  ['skipToFirst ^..', '^.. foo >>>'],
  ['skipToLast ..^', '..^ foo >>>'],
  ['skipToNth ^3..', '^3.. foo >>>'],
  ['вставка в конец файла ... >>>', '... >>>'],
  ['вставка в начало файла >>> foo', '>>> foo'],
  ['Python с отступом в raw', 'def foo():\n    return None\n>>>', 'python'],
  ['include с ведущим пробелом', '  #include "x.h"\n>>>'],
];

for (const [name, body, lang] of CASES) {
  test(`round-trip: ${name}`, () => {
    const original = firstMatch(wrapMatch(body, lang ?? 'cpp'));
    const reparsed = roundtrip(original, lang ?? 'cpp');
    assert.deepStrictEqual(strip(reparsed), strip(original));
  });
}

// Двойной прогон должен быть стабильной точкой (идемпотентность печати).
test('round-trip стабилен при двойном прогоне', () => {
  const original = firstMatch(wrapMatch('namespace N {\n...\n>>>\n}'));
  const once = roundtrip(original);
  const twice = roundtrip(once);
  assert.deepStrictEqual(strip(twice), strip(once));
});

// ── экранирование операторов в литералах (принтер реэкранирует) ──────────────
// raw содержит текст, совпадающий с оператором (пришёл из «\...»); принтер обязан
// вернуть «\», иначе перепечатка оттокенизирует его обратно в оператор.
for (const [name, body] of [
  ['обособленный «...» как литерал', '\\... >>> foo'],
  ['оператор в середине литерала', 'a \\... b >>>'],
  ['экранированный оператор внутри склейки', 'a\n\\... \nb\n>>>'],
  ['несколько экранированных подряд', '\\>>> \\<<< >>> x'],
  ['экранированный ^2..', '\\^2.. foo >>>'],
] as const) {
  test(`round-trip (экранирование): ${name}`, () => {
    const original = firstMatch(wrapMatch(body));
    const reparsed = roundtrip(original);
    assert.deepStrictEqual(strip(reparsed), strip(original));
  });
}