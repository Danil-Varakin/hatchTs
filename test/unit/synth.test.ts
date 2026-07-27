import { test } from 'node:test';
import assert from 'node:assert/strict';

import { synthesize } from '../../src/generate/synth.ts';
import type { SynthEvent } from '../../src/generate/synth.ts';
import { applyAll } from '../../src/cli/apply.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { printPattern } from '../../src/core/hatch-printer.ts';
import type { HatchFile } from '../../src/core/ast.ts';

function hatchFile(hunks: ReturnType<typeof synthesize>): HatchFile {
  return { hunks: hunks.map((h) => ({ ...h, mdSpan: [0, 0] as [number, number] })) };
}

// Round-trip: сгенерировать ханки из (old,new), применить к old, сверить с new.
// exact: true — проверяем ДОСЛОВНОЕ воспроизведение (assert.equal ниже дословный,
// так что нестрогий режим здесь ничего бы не доказал).
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
  // round-trip
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  // и в шаблоне — родитель void b(), а не соседняя строка
  assert.match(printPattern(hunks[0]!.match), /void b\(\)/);
});

test('интерференция ханков: ханк меняет привязку другого — synth строит против уже-применённого', async () => {
  await cppAdapter.init();
  // ханк 1 меняет сигнатуру f; ханк 2 (неуникальный return a;) должен привязаться
  // к НОВОЙ сигнатуре void f(int b), т.к. старая к моменту его применения исчезнет.
  const oldStr = 'int g() { return a; }\nvoid f(int a) {\n  helper();\n  return a;\n}\n';
  const newStr = 'int g() { return a; }\nvoid f(int b) {\n  helper();\n  return b;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(hunks.length, 2);
  // Привязка к f (её сигнатура обобщена скобками — `void f( ... )`, §2.5). Что это
  // именно НОВОЕ (уже-применённое) состояние, гарантирует round-trip ниже: к старой
  // `void f(int a)` ханк 2 не привязался бы — её нет к моменту его применения.
  assert.match(printPattern(hunks[1]!.match), /void f\(/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('замена со СМЕНОЙ отступа первой строки: дедент и углубление (round-trip)', async () => {
  await roundtrip('void f() {\n      target();\n  keep();\n}\n', 'void f() {\n  target2();\n  keep();\n}\n'); // дедент
  await roundtrip('void f() {\n  x();\n}\n', 'void f() {\n      x2();\n}\n'); // глубже
});

test('вставка в КОНЕЦ блока привязывается к "}" (структурно), не к последней строке', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  a();\n}\nvoid g() {\n  a();\n}\n';
  const newStr = 'void f() {\n  a();\n}\nvoid g() {\n  a();\n  NEW();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void g\(\)/); // родитель для уникальности '}'
  assert.doesNotMatch(p, /a\(\);\s*\n>>>/); // НЕ цепляется за соседнюю a();
  // робастность: сосед a() уехал в a(x) — вставка всё равно ложится в g()
  const drifted = 'void f() {\n  a();\n}\nvoid g() {\n  a(x);\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('NEW();') && source.includes('a(x)'), source);
});

test('спец-случаи: BOF-вставка `>>> ...`, EOF-дозапись `... >>>`, замена всего файла', async () => {
  await cppAdapter.init();
  const bof = synthesize('int b = 2;\n', 'int a = 1;\nint b = 2;\n', cppAdapter);
  assert.match(printPattern(bof[0]!.match), /^>>>/); // вставка в начало
  await roundtrip('int b = 2;\n', 'int a = 1;\nint b = 2;\n');

  const eofp = synthesize('int a = 1;\n', 'int a = 1;\nint z = 9;\n', cppAdapter);
  assert.match(printPattern(eofp[0]!.match), />>>$/); // дозапись в конец
  await roundtrip('int a = 1;\n', 'int a = 1;\nint z = 9;\n');

  const whole = synthesize('int old = 1;\n', 'int a = 2;\nint b = 3;\n', cppAdapter);
  assert.equal(printPattern(whole[0]!.match).replace(/\s/g, ''), '>>>...<<<'); // весь файл
  await roundtrip('int old = 1;\n', 'int a = 2;\nint b = 3;\n');
});

test('вставка в конец блока — форма `>>> }` БЕЗ <<< (чистая точка)', async () => {
  await cppAdapter.init();
  const hunks = synthesize('void f() {\n  a();\n}\n', 'void f() {\n  a();\n  b();\n}\n', cppAdapter);
  assert.doesNotMatch(printPattern(hunks[0]!.match), /<<</); // вставка = только >>>
  await roundtrip('void f() {\n  a();\n}\n', 'void f() {\n  a();\n  b();\n}\n');
});

test('верификация: synthesize сам гарантирует applyAll==new (замена + вставка в конец тела)', async () => {
  await cppAdapter.init();
  const oldStr = 'namespace n {\nvoid f() {\n  int x = 1;\n  g(x);\n}\nvoid h() {\n  int y = 1;\n}\n}\n';
  const newStr = 'namespace n {\nvoid f() {\n  int x = 2;\n  g(x);\n  extra();\n}\nvoid h() {\n  int y = 1;\n}\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter); // не бросило → верификация внутри прошла
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('удаление блока с ПУСТОЙ строкой над ним: якорь уползает к непустой, НЕ ищет с BOF', async () => {
  await cppAdapter.init();
  const oldStr = 'void Test() {\n  int a = 1;\n\n  for (int i = 0; i < 3; i++) {\n    doit(i);\n  }\n}\n';
  const newStr = 'void Test() {\n  int a = 1;\n\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  // шаблон НЕ должен начинаться с >>> (это была бы привязка к началу файла)
  assert.doesNotMatch(printPattern(hunks[0]!.match), /^>>>/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('удаление строки с ПУСТОЙ строкой под ней: рез не уезжает в EOF (патч мал)', async () => {
  await cppAdapter.init();
  const oldStr = 'namespace n {\nvoid f() {\n  keep1();\n  DELME();\n\n  keep2();\n}\n}\n';
  const newStr = 'namespace n {\nvoid f() {\n  keep1();\n\n  keep2();\n}\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  // патч — только склейка соседей, а НЕ весь хвост файла (баг: <<< уезжал в eof)
  assert.doesNotMatch(hunks[0]!.patch, /namespace|keep2/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('трейсер (--debug): видны сегмент, пробная НЕуникальная и итоговая уникальная привязка', async () => {
  await cppAdapter.init();
  // Два одинаковых оператора в ОДНОЙ функции: родитель их не различает, поэтому
  // проба с родителем неуникальна и лестница идёт дальше — обе пробы видны в трейсе.
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
  // Две функции Allman-стиля с одинаковым телом: «строка с {» это просто '{' у обеих
  // → бесполезный якорь. Уникальность даёт только ЗАГОЛОВОК узла (void b()).
  const oldStr = 'void a()\n{\n  int x = 1;\n}\nvoid b()\n{\n  int x = 1;\n}\n';
  const newStr = 'void a()\n{\n  int x = 1;\n}\nvoid b()\n{\n  int x = 99;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void b\(/); // якорь — сигнатура b, а не '{'
  assert.doesNotMatch(p, /^\s*\.\.\.\s*\{\s*\.\.\./m); // НЕ голый '{' как родитель
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
  assert.match(p, /void render\(\s*\.\.\.\s*\)/); // параметры обобщены в `...`
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  // дрейф сигнатуры (параметр убрали) — обобщённый якорь `render( ... )` всё равно ложится
  const drifted =
    'void handle(int code, bool flag) {\n  process();\n}\nvoid render(int code) {\n  process();\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('process(2);') && source.includes('void render(int code) {'), source);
});

test('8a: двусторонний добор — различитель СНИЗУ (соседа сверху и родителя мало)', async () => {
  await cppAdapter.init();
  // Обе `val = 1;` в ОДНОЙ функции, сверху у обеих `a();` (не различает), родитель
  // один. Различает только строка СНИЗУ: у первой — `b();`, у второй — `c();`.
  const oldStr = 'void f() {\n  a();\n  val = 1;\n  b();\n  a();\n  val = 1;\n  c();\n}\n';
  const newStr = 'void f() {\n  a();\n  val = 9;\n  b();\n  a();\n  val = 1;\n  c();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /b\(\);/); // в якоре появился НИЖНИЙ сосед b();
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('робастность: правка ложится даже при ДРЕЙФЕ соседей (как в Chromium)', async () => {
  await cppAdapter.init();
  const oldStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 1;\n}\n';
  const newStr = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 99;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  // применяем к файлу, где у соседа появилась НОВАЯ строка (окружение изменилось)
  const drifted = 'void a() {\n  int x = 1;\n}\nvoid b() {\n  int x = 1;\n  LOG(hi);\n}\n';
  const { source } = applyAll(drifted, hatchFile(hunks), cppAdapter);
  assert.ok(source.includes('int x = 99;'), source);
  assert.ok(source.includes('LOG(hi);'), 'сосед сохранился');
});

// ── края файла и блока: границы берутся из ПОЗИЦИИ, а не из номера строки ────────

test('край файла: пустые строки сверху/снизу не мешают привязке (номер строки ≠ край)', async () => {
  // Пустая строка сдвигает номера, поэтому «правка в строке 1» не срабатывает, а
  // canonStart===0 («выше нет ничего значащего») — срабатывает.
  await roundtrip('\nvoid f() {}\n', '\nint g = 0;\nvoid f() {}\n'); // вставка перед первой значащей
  await roundtrip('void f() {}\n\n', 'void f() {}\nint g = 0;\n\n'); // вставка перед хвостовой пустой
  await roundtrip('void f() {}\n\n', 'void f() {}\n\nint g = 0;\n'); // дозапись в самый конец
  await roundtrip('int old = 1;\n\n\n', 'int a = 2;\n\n\n'); // «весь значащий файл», хвост пустых цел
});

test('удаление ПЕРВОЙ строки файла держится за СОДЕРЖИМОЕ, а не за начало файла', async () => {
  await cppAdapter.init();
  // «Удалить первую строку» — это удаление КОНКРЕТНОЙ строки, которая просто лежит
  // с краю: сверху могут дописать что угодно, и ханк обязан это пережить. Поэтому
  // левый край реза — сам снимаемый кусок, а не позиция 0.
  const oldStr = 'int a = 1;\nint b = 2;\n';
  const newStr = 'int b = 2;\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.match(printPattern(hunks[0]!.match), /^\.\.\./); // НЕ привязка встык к BOF
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  // сверху дописали строку — ханк всё равно снимает свою
  const drifted = '#include <a>\nint a = 1;\nint b = 2;\n';
  assert.equal(applyAll(drifted, hatchFile(hunks), cppAdapter).source, '#include <a>\nint b = 2;\n');
});

test('удаление ПОСЛЕДНЕЙ строки файла держится за СОДЕРЖИМОЕ, а не за EOF', async () => {
  await cppAdapter.init();
  const oldStr = 'int a = 1;\nint b = 2;\n';
  const newStr = 'int a = 1;\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  // снизу дописали строку — ханк снимает свою, а не хвост файла
  const drifted = 'int a = 1;\nint b = 2;\nint c = 3;\n';
  assert.equal(applyAll(drifted, hatchFile(hunks), cppAdapter).source, 'int a = 1;\nint c = 3;\n');
});

test('удаление ПУСТОЙ строки: рез по зазору соседей, без литерала-пустышки', async () => {
  // Снимаемое пусто по канону — литерала из него не бывает (карта бросает на пустом
  // литерале). Форма `A >>> ... <<< B` режет зазор между соседями.
  await roundtrip('void f() {\n  a();\n\n  b();\n}\n', 'void f() {\n  a();\n  b();\n}\n');
});

test('файл без хвостового перевода строки не отращивает лишний \\n', async () => {
  await roundtrip('int a = 1;\nint b = 2;', 'int a = 1;\nint c = 3;');
  await roundtrip('int a = 1;\n', 'int a = 1;\nint b = 2;'); // new без \n на конце
});

// ── закрывашка родителя: незакрытая `{` упорядочивает, но не запирает ────────────

test('родитель ЗАКРЫВАЕТСЯ в шаблоне: иначе якорь ловит и соседний блок', async () => {
  await cppAdapter.init();
  // Два одинаковых тела в двух циклах одной функции. Родитель `for (…) {` без своей
  // `}` НЕ запирает поиск (§0.1 матчера) — `use(b);` второго цикла тоже подходит.
  const oldStr =
    'void f() {\n  for (auto& b : first(a)) {\n    use(b);\n  }\n  for (auto& b : second(c)) {\n    use(b);\n  }\n}\n';
  const newStr = oldStr.replace('    use(b);\n  }\n  for (auto& b : second', '    use2(b);\n  }\n  for (auto& b : second');
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /first\(/); // привязались к первому циклу
  assert.match(p, /<<<[\s\S]*\}/); // и ЗАКРЫЛИ его — иначе матч неоднозначен
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('вставка ПЕРВОЙ строкой блока: якорь — заголовок родителя, без дубля `{`', async () => {
  await cppAdapter.init();
  // Allman: сосед сверху — строка `{`, ровно та же скобка, что уже закрыла заголовок.
  // Если её выдать соседом, шаблон потребует ВТОРУЮ `{` и не ляжет никуда.
  const oldStr = 'void a()\n{\n  b();\n}\nvoid c()\n{\n  b();\n}\n';
  const newStr = 'void a()\n{\n  b();\n}\nvoid c()\n{\n  z();\n  b();\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  const p = printPattern(hunks[0]!.match);
  assert.match(p, /void c\(\)/);
  assert.doesNotMatch(p, /\{\n\.\.\.\n\{/); // нет требования двух `{` подряд
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
});

test('правка съедает `}` родителя: такой блок не идёт ни в якоря, ни в закрывашки', async () => {
  // Удаление `};` уничтожает класс: закрывать в шаблоне нечего, якорем снизу он тоже
  // быть не может — родителем остаётся только namespace.
  await roundtrip(
    'namespace n {\nclass W {\n  int id_;\n};\n\n}  // namespace n\n',
    'namespace n {\nclass W {\n  int id_;\n\n}  // namespace n\n',
  );
});

test('вставка со СВОИМ отступом (таб рядом с пробелами) воспроизводится дословно', async () => {
  // Чистая точка `>>>` режет по границе пробелов, поэтому отступ вставки поехал бы;
  // запасная форма — рез по зазору между соседями — точна.
  await roundtrip('void f() {\n  a();\n\n  b();\n}\n', 'void f() {\n  a();\n\n\tint tabbed = 1;\n  b();\n}\n');
});

test('флаг exact: строгий режим — дословно, нестрогий — по нормализации', async () => {
  await cppAdapter.init();
  // Whitespace-тяжёлый случай: смена отступа + таб рядом с пробелами + пустая строка.
  const oldStr = 'void f() {\n      deep();\n\n  b();\n}\n';
  const newStr = 'void f() {\n  deep();\n\n\tint tabbed = 1;\n  b();\n}\n';

  // exact: применение ханков обязано дать new БАЙТ В БАЙТ (внутри synthesize это же и
  // проверяется — не бросило, значит гарантия соблюдена).
  const strict = synthesize(oldStr, newStr, cppAdapter, { exact: true });
  assert.equal(applyAll(oldStr, hatchFile(strict), cppAdapter).source, newStr);

  // Без флага обязательна только сверка по канону языка.
  const loose = synthesize(oldStr, newStr, cppAdapter);
  const looseOut = applyAll(oldStr, hatchFile(loose), cppAdapter).source;
  assert.equal(cppAdapter.normalize(looseOut), cppAdapter.normalize(newStr));
  // На адаптере C++ оба режима СЕГОДНЯ сходятся: текст патча извлекается из
  // intendedSource между теми же смещениями реза (extractReplacementText), поэтому
  // принятый кандидат почти всегда воспроизводит правку и дословно. Ассерт ниже
  // фиксирует это как факт, а не как требование к нестрогому режиму — если он
  // однажды отвалится, менять надо его, а не гарантию.
  assert.equal(looseOut, newStr);
});

test('нестрогий режим НЕ имеет права съесть строку: сверка построчная, не по всему тексту', async () => {
  await cppAdapter.init();
  // Регрессия (Chromium, блок #include): сверка «нормализовать оба текста целиком»
  // пропускала ханк с патчем "" вместо "\n\n" — normalize не видит переводов строк,
  // для него это одно и то же. Файл терял строки, а следующий сегмент адресуется
  // номером строки (oldStart + rowShift) → он строился по чужому тексту и падал
  // AmbiguityError'ом далеко от места, где приняли щедрого кандидата.
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
  // `target = 1;` уникальна в файле — «голый минимум» лёг бы и без контекста, но такой
  // ханк на дрейфе уезжает в другую функцию. Привязка обязана быть СТРУКТУРНОЙ (§0.1).
  const oldStr = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n  target = 1;\n}\n';
  const newStr = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n  target = 2;\n}\n';
  const hunks = synthesize(oldStr, newStr, cppAdapter);
  assert.match(printPattern(hunks[0]!.match), /void b\(\)/);
  assert.equal(applyAll(oldStr, hatchFile(hunks), cppAdapter).source, newStr);
  // дрейф: в b() правки больше нет, зато похожая строка появилась в НОВОЙ функции —
  // ханк обязан отказаться, а не молча уехать туда
  const drifted = 'void a() {\n  keep();\n}\nvoid b() {\n  keep();\n}\nvoid c() {\n  target = 1;\n}\n';
  assert.throws(() => applyAll(drifted, hatchFile(hunks), cppAdapter));
});
