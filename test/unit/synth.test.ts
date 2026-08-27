import { test } from 'node:test';
import assert from 'node:assert/strict';

import { synthesize } from '../../src/generate/synth.ts';
import type { SynthEvent } from '../../src/generate/synth.ts';
import { applyAll } from '../../src/core/apply.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { printPattern } from '../../src/core/hatch-printer.ts';
import type { HatchFile } from '../../src/core/ast.ts';

function hatchFile(hunks: ReturnType<typeof synthesize>): HatchFile {
  return { hunks: hunks.map((h) => ({ ...h, mdSpan: [0, 0] as [number, number] })) };
}

async function roundtrip(oldStr: string, newStr: string, bridgeGap = 0): Promise<void> {
  await cppAdapter.init();
  const hunks = synthesize(oldStr, newStr, cppAdapter, { bridgeGap, exact: true });
  const { source } = applyAll(oldStr, hatchFile(hunks), cppAdapter);
  assert.equal(source, newStr);
}

test('замена одной строки в теле функции', async () => {
  const oldStr = 'void f() {\n  int a = 1;\n  return a;\n}\n';
  const newStr = 'void f() {\n  int a = 2;\n  return a;\n}\n';
  await roundtrip(oldStr, newStr);
});

test('вставка строки в тело функции', async () => {
  const oldStr = 'void f() {\n  int a = 1;\n  return a;\n}\n';
  const newStr = 'void f() {\n  int a = 1;\n  a += 5;\n  return a;\n}\n';
  await roundtrip(oldStr, newStr);
});

test('удаление строки', async () => {
  const oldStr = 'void f() {\n  int a = 1;\n  int b = 2;\n  return a;\n}\n';
  const newStr = 'void f() {\n  int a = 1;\n  return a;\n}\n';
  await roundtrip(oldStr, newStr);
});

test('замена со СМЕНОЙ отступа первой строки', async () => {
  const oldStr = 'void f() {\n  g();\n}\n';
  const newStr = 'void f() {\n  if (x) {\n      g();\n  }\n}\n';
  await roundtrip(oldStr, newStr);
});

test('многострочная замена блока', async () => {
  const oldStr = 'void f() {\n  a();\n  b();\n  c();\n}\n';
  const newStr = 'void f() {\n  x();\n  y();\n}\n';
  await roundtrip(oldStr, newStr);
});

test('две раздельные правки в одном файле (последовательность)', async () => {
  const oldStr = 'int a = 1;\nint b = 2;\nint c = 3;\nint d = 4;\nint e = 5;\n';
  const newStr = 'int a = 10;\nint b = 2;\nint c = 3;\nint d = 4;\nint e = 50;\n';
  await roundtrip(oldStr, newStr);
});

test('две БЛИЗКИЕ правки в одном блоке (уникальность через контекст)', async () => {
  const oldStr = 'void f() {\n  x = 1;\n  y = 2;\n  z = 3;\n}\n';
  const newStr = 'void f() {\n  x = 11;\n  y = 2;\n  z = 33;\n}\n';
  await roundtrip(oldStr, newStr);
});

test('правка у начала файла (BOF)', async () => {
  const oldStr = '#include <a>\nvoid f() {}\n';
  const newStr = '#include <b>\nvoid f() {}\n';
  await roundtrip(oldStr, newStr);
});

test('привязка СТРУКТУРНАЯ: неуникальный код добирается РОДИТЕЛЕМ, не соседом', async () => {
  await cppAdapter.init();
  const oldStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 1;\n}\n';
  const newStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 99;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  assert.match(printPattern(hunks[0]!.match), /void b\(\)/);
});

test('интерференция ханков: ханк меняет привязку другого — synth строит против уже-применённого', async () => {
  await cppAdapter.init();
  const oldStr = 'int g() { return a; }\nvoid f(int a) {\n  helper();\n  return a;\n}\n';
  const newStr = 'int g() { return a; }\nvoid f(int b) {\n  helper();\n  return b;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(hunks.length, 2);
  assert.match(printPattern(hunks[1]!.match), /void f\(/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('замена со СМЕНОЙ отступа первой строки: дедент и углубление (round-trip)', async () => {
  await roundtrip('void f() {\n      target();\n  keep();\n}\n', 'void f() {\n  target2();\n  keep();\n}\n');
  await roundtrip('void f() {\n  x();\n}\n', 'void f() {\n      x2();\n}\n');
});

test('вставка в КОНЕЦ блока привязывается к "}" (структурно), не к последней строке', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  a();\n}\nvoid g() {\n  a();\n}\n';
  const newStr = 'void f() {\n  a();\n}\nvoid g() {\n  a();\n  NEW();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void g\(\)/);
  assert.doesNotMatch(p, /a\(\);\s*\n>>>/);
  const drifted = 'void f() {\n  a();\n}\nvoid g() {\n  a(x);\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('NEW();') && source.includes('a(x)'), source);
});

test('спец-случаи: BOF-вставка `>>> ...`, EOF-дозапись `... >>>`, замена всего файла', async () => {
  await cppAdapter.init();
  const bof = synthesize('int b = 2;\n', 'int a = 1;\nint b = 2;\n', cppAdapter);
  assert.match(printPattern(bof[0]!.match), /^>>>/);
  await roundtrip('int b = 2;\n', 'int a = 1;\nint b = 2;\n');

  const eofp = synthesize('int a = 1;\n', 'int a = 1;\nint z = 9;\n', cppAdapter);
  assert.match(printPattern(eofp[0]!.match), />>>$/);
  await roundtrip('int a = 1;\n', 'int a = 1;\nint z = 9;\n');

  const whole = synthesize('int old = 1;\n', 'int a = 2;\nint b = 3;\n', cppAdapter);
  assert.equal(printPattern(whole[0]!.match).replace(/\s/g, ''), '>>>...<<<');
  await roundtrip('int old = 1;\n', 'int a = 2;\nint b = 3;\n');
});

test('вставка в конец блока — форма `>>> }` БЕЗ <<< (чистая точка)', async () => {
  await cppAdapter.init();
  const hunks = synthesize('void f() {\n  a();\n}\n', 'void f() {\n  a();\n  b();\n}\n', cppAdapter);
  assert.doesNotMatch(printPattern(hunks[0]!.match), /<<</);
  await roundtrip('void f() {\n  a();\n}\n', 'void f() {\n  a();\n  b();\n}\n');
});

test('верификация: synthesize сам гарантирует applyAll==new (замена + вставка в конец тела)', async () => {
  await cppAdapter.init();
  const oldStr = 'namespace n {\nvoid f() {\n  int x = 1;\n  g(x);\n}\nvoid h() {\n  int y = 1;\n}\n}\n';
  const newStr = 'namespace n {\nvoid f() {\n  int x = 2;\n  g(x);\n  extra();\n}\nvoid h() {\n  int y = 1;\n}\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('удаление блока с ПУСТОЙ строкой над ним: якорь уползает к непустой, НЕ ищет с BOF', async () => {
  await cppAdapter.init();
  const oldStr = 'void Test() {\n  int a = 1;\n\n  for (int i = 0; i < 3; i++) {\n    doit(i);\n  }\n}\n';
  const newStr = 'void Test() {\n  int a = 1;\n\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.doesNotMatch(printPattern(hunks[0]!.match), /^>>>/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('удаление строки с ПУСТОЙ строкой под ней: рез не уезжает в EOF (патч мал)', async () => {
  await cppAdapter.init();
  const oldStr = 'namespace n {\nvoid f() {\n  keep1();\n  DELME();\n\n  keep2();\n}\n}\n';
  const newStr = 'namespace n {\nvoid f() {\n  keep1();\n\n  keep2();\n}\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.doesNotMatch(hunks[0]!.patch, /namespace|keep2/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('трейсер (--debug): видны сегмент, пробная НЕуникальная и итоговая уникальная привязка', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  int x = 1;\n  int y = 2;\n  int x = 1;\n}\n';
  const newStr = 'void f() {\n  int x = 99;\n  int y = 2;\n  int x = 1;\n}\n';
  const events: SynthEvent[] = [];
  synthesize(oldStr, newStr, cppAdapter, { trace: (e) => events.push(e) });
  assert.ok(events.some((e) => e.kind === 'segment'));
  const attempts = events.filter((e) => e.kind === 'attempt');
  assert.ok(attempts.some((e) => e.result === 'ambiguous'), 'должна быть неуникальная проба');
  assert.ok(attempts.some((e) => e.result === 'unique'), 'и итоговая уникальная');
  assert.ok(events.some((e) => e.kind === 'hunk'));
});

test('8b: заголовок узла — Allman-стиль ({ на своей строке) привязывается к сигнатуре', async () => {
  await cppAdapter.init();
  const oldStr = 'void a()\n{\n  int x = 1;\n}\nvoid b()\n{\n  int x = 1;\n}\n';
  const newStr = 'void a()\n{\n  int x = 1;\n}\nvoid b()\n{\n  int x = 99;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void b\(/);
  assert.doesNotMatch(p, /^\s*\.\.\.\s*\{\s*\.\.\./m);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('9: обобщение скобок — сигнатура с параметрами → `void render( ... )`, переживает дрейф', async () => {
  await cppAdapter.init();
  const oldStr =
    'void handle(int code, bool flag) {\n  process();\n}\nvoid render(int code, bool flag) {\n  process();\n}\n';
  const newStr =
    'void handle(int code, bool flag) {\n  process();\n}\nvoid render(int code, bool flag) {\n  process(2);\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void render\(\s*\.\.\.\s*\)/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  const drifted =
    'void handle(int code, bool flag) {\n  process();\n}\nvoid render(int code) {\n  process();\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('process(2);') && source.includes('void render(int code) {'), source);
});

test('8a: двусторонний добор — различитель СНИЗУ (соседа сверху и родителя мало)', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  a();\n  val = 1;\n  b();\n  a();\n  val = 1;\n  c();\n}\n';
  const newStr = 'void f() {\n  a();\n  val = 9;\n  b();\n  a();\n  val = 1;\n  c();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /b\(\);/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('робастность: правка ложится даже при ДРЕЙФЕ соседей (как в Chromium)', async () => {
  await cppAdapter.init();
  const oldStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 1;\n}\n';
  const newStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 99;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const drifted = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 1;\n  LOG(hi);\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('int x = 99;'), source);
  assert.ok(source.includes('LOG(hi);'), 'сосед сохранился');
});

// ── края файла и блока: границы берутся из ПОЗИЦИИ, а не из номера строки ────────

test('край файла: пустые строки сверху/снизу не мешают привязке (номер строки ≠ край)', async () => {
  await roundtrip('\nvoid f() {}\n', '\nint g = 0;\nvoid f() {}\n');
  await roundtrip('void f() {}\n\n', 'void f() {}\nint g = 0;\n\n');
  await roundtrip('void f() {}\n\n', 'void f() {}\n\nint g = 0;\n');
  await roundtrip('int old = 1;\n\n\n', 'int a = 2;\n\n\n');
});

test('удаление ПЕРВОЙ строки файла держится за СОДЕРЖИМОЕ, а не за начало файла', async () => {
  await cppAdapter.init();
  const oldStr = 'int a = 1;\nint b = 2;\n';
  const newStr = 'int b = 2;\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.match(printPattern(hunks[0]!.match), /^\.\.\./);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  const drifted = '#include <a>\nint a = 1;\nint b = 2;\n';
  assert.equal(applyAll(drifted, hatchFile(hunks), cppAdapter).source, '#include <a>\nint b = 2;\n');
});

test('удаление ПОСЛЕДНЕЙ строки файла держится за СОДЕРЖИМОЕ, а не за EOF', async () => {
  await cppAdapter.init();
  const oldStr = 'int a = 1;\nint b = 2;\n';
  const newStr = 'int a = 1;\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  const drifted = 'int a = 1;\nint b = 2;\nint c = 3;\n';
  assert.equal(applyAll(drifted, hatchFile(hunks), cppAdapter).source, 'int a = 1;\nint c = 3;\n');
});

test('удаление ПУСТОЙ строки: рез по зазору соседей, без литерала-пустышки', async () => {
  await roundtrip('void f() {\n  a();\n\n  b();\n}\n', 'void f() {\n  a();\n  b();\n}\n');
});

test('файл без хвостового перевода строки не отращивает лишний \\n', async () => {
  await roundtrip('int a = 1;\nint b = 2;', 'int a = 1;\nint c = 3;');
  await roundtrip('int a = 1;\n', 'int a = 1;\nint b = 2;');
});

// ── закрывашка родителя: незакрытая `{` упорядочивает, но не запирает ────────────

test('родитель ЗАКРЫВАЕТСЯ в шаблоне: иначе якорь ловит и соседний блок', async () => {
  await cppAdapter.init();
  const oldStr =
    'void f() {\n  for (auto& b : first(a)) {\n    use(b);\n  }\n  for (auto& b : second(c)) {\n    use(b);\n  }\n}\n';
  const newStr = oldStr.replace('    use(b);\n  }\n  for (auto& b : second', '    use2(b);\n  }\n  for (auto& b : second');
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /first\(/);
  assert.match(p, /<<<[\s\S]*\}/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('вставка ПЕРВОЙ строкой блока: якорь — заголовок родителя, без дубля `{`', async () => {
  await cppAdapter.init();
  const oldStr = 'void a()\n{\n  b();\n}\nvoid c()\n{\n  b();\n}\n';
  const newStr = 'void a()\n{\n  b();\n}\nvoid c()\n{\n  z();\n  b();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void c\(\)/);
  assert.doesNotMatch(p, /\{\n\.\.\.\n\{/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('правка съедает `}` родителя: такой блок не идёт ни в якоря, ни в закрывашки', async () => {
  await roundtrip(
    'namespace n {\nclass W {\n  int id_;\n};\n\n}  // namespace n\n',
    'namespace n {\nclass W {\n  int id_;\n\n}  // namespace n\n',
  );
});

test('вставка со СВОИМ отступом (таб рядом с пробелами) воспроизводится дословно', async () => {
  await roundtrip('void f() {\n  a();\n\n  b();\n}\n', 'void f() {\n  a();\n\n\tint tabbed = 1;\n  b();\n}\n');
});

test('флаг exact: строгий режим — дословно, нестрогий — по нормализации', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n      deep();\n\n  b();\n}\n';
  const newStr = 'void f() {\n  deep();\n\n\tint tabbed = 1;\n  b();\n}\n';

  const strict = synthesize(oldStr, newStr, cppAdapter, { exact: true });
  assert.equal(applyAll(oldStr, hatchFile(strict), cppAdapter).source, newStr);

  const loose = synthesize(oldStr, newStr, cppAdapter);
  const looseOut = applyAll(oldStr, hatchFile(loose), cppAdapter).source;
  assert.equal(cppAdapter.normalize(looseOut), cppAdapter.normalize(newStr));
  assert.equal(looseOut, newStr);
});

test('нестрогий режим НЕ имеет права съесть строку: сверка построчная, не по всему тексту', async () => {
  await cppAdapter.init();
  const oldStr =
    '#include <vector>\n#include <string_view>\n\n\n#include "a.h"\n#include "to_vector.h"\n#include "b.h"\n';
  const newStr = '#include <vector>\n\n#include "a.h"\n#include "b.h"\n';

  for (const exact of [false, true]) {
    const hunks = synthesize(oldStr, newStr, cppAdapter, { exact });
    assert.equal(
      applyAll(oldStr, hatchFile(hunks), cppAdapter).source,
      newStr,
      `режим exact=${exact} обязан воспроизвести состав строк`,
    );
  }
});

test('структура с НУЛЕВОЙ ступени: уникальная сама по себе правка всё равно несёт родителя', async () => {
  await cppAdapter.init();
  const oldStr = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n  target = 1;\n}\n';
  const newStr = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n  target = 2;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.match(printPattern(hunks[0]!.match), /void b\(\)/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  const drifted = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n}\nvoid c() {\n  target = 1;\n}\n';
  assert.throws(() => applyAll(drifted, hatchFile(hunks), cppAdapter));
});
