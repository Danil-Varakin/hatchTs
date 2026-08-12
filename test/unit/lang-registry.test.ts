// Реестр языков ЦЕЛИКОМ: для каждого языка Chromium-набора — грамматика грузится,
// карта строится, и правка ложится СКВОЗЬ настоящий конвейер (parser → matcher →
// patcher). Смысл теста не в покрытии синтаксиса каждого языка, а в проверке
// ГРАНИЦЫ: языки скобочного семейства не приносят ни строчки своей логики (общий
// lang/brace-family.ts), поэтому новый язык обязан работать сразу — если какой-то
// не работает, дело в грамматике/расширении, а не в ядре (00-general-rules §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { applyAll } from '../../src/cli/apply.ts';
import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { adapterForLanguage, adapterForFile } from '../../src/lang/adapter.ts';
import { hatchMd } from '../helpers.ts';

interface Case {
  lang: string; // имя для заголовка `# match <lang>`
  file: string; // имя файла — проверяет автоопределение по расширению
  source: string;
  /** заголовок ВТОРОЙ функции — якорь, вводящий в её тело */
  header: string;
  /** строка тела второй функции — якорь перед точкой вставки */
  body: string;
}

// Во всех случаях файл устроен одинаково: две функции-близнеца, правка обязана
// попасть во ВТОРУЮ. Без структурной привязки якорь `b()` уникален, поэтому
// заголовок здесь не «для уникальности», а для того, чтобы правка была ВНУТРИ тела.
const CASES: readonly Case[] = [
  {
    lang: 'cpp',
    file: 'a.cc',
    source: 'void first() {\n  a();\n}\n\nvoid second() {\n  b();\n}\n',
    header: 'void second() {',
    body: '  b();',
  },
  {
    lang: 'c',
    file: 'a.c',
    source: 'void first(void) {\n  a();\n}\n\nvoid second(void) {\n  b();\n}\n',
    header: 'void second(void) {',
    body: '  b();',
  },
  {
    lang: 'objc',
    file: 'a.m',
    source:
      '@implementation Foo\n- (void)first {\n  [self a];\n}\n\n- (void)second {\n  [self b];\n}\n@end\n',
    header: '- (void)second {',
    body: '  [self b];',
  },
  {
    lang: 'javascript',
    file: 'a.js',
    source: 'function first() {\n  a();\n}\n\nfunction second() {\n  b();\n}\n',
    header: 'function second() {',
    body: '  b();',
  },
  {
    lang: 'typescript',
    file: 'a.ts',
    source:
      'function first(): void {\n  a();\n}\n\nfunction second(): void {\n  b();\n}\n',
    header: 'function second(): void {',
    body: '  b();',
  },
  {
    lang: 'tsx',
    file: 'a.tsx',
    source:
      'const first = () => {\n  return <div>a</div>;\n};\n\nconst second = () => {\n  return <div>b</div>;\n};\n',
    header: 'const second = () => {',
    body: '  return <div>b</div>;',
  },
  {
    lang: 'rust',
    file: 'a.rs',
    source: 'fn first() {\n    a();\n}\n\nfn second() {\n    b();\n}\n',
    header: 'fn second() {',
    body: '    b();',
  },
  {
    lang: 'java',
    file: 'A.java',
    source:
      'class A {\n  void first() {\n    a();\n  }\n\n  void second() {\n    b();\n  }\n}\n',
    header: 'void second() {',
    body: '    b();',
  },
  {
    lang: 'kotlin',
    file: 'A.kt',
    source: 'fun first() {\n    a()\n}\n\nfun second() {\n    b()\n}\n',
    header: 'fun second() {',
    body: '    b()',
  },
  {
    lang: 'go',
    file: 'a.go',
    source: 'package main\n\nfunc first() {\n\ta()\n}\n\nfunc second() {\n\tb()\n}\n',
    header: 'func second() {',
    body: '\tb()',
  },
];

for (const c of CASES) {
  test(`${c.lang}: grammar + map + edit inside the wanted body`, async () => {
    const adapter = adapterForLanguage(c.lang);
    assert.equal(adapterForFile(c.file), adapter, 'file extension → the same adapter');

    await adapter.init(); // грузится .wasm — здесь ловится и битый путь, и чужой ABI

    // карта: тело второй функции лежит ГЛУБЖЕ верхнего уровня и где-то кончается
    const map = adapter.buildMap(c.source);
    const canon = adapter.normalize(c.source);
    const inBody = canon.indexOf(adapter.normalize(c.body));
    assert.notEqual(inBody, -1);
    assert.ok(map.depthAt(inBody) >= 1, `depth ${map.depthAt(inBody)}`);
    const spans = map.enclosing(inBody);
    assert.ok(spans.length >= 1, 'тело функции — блок');
    // заголовок конструкции выражается текстом: [headerStart, open] непустой
    const withHeader = spans.filter((s) => s.headerStart !== undefined);
    assert.ok(withHeader.length >= 1, 'у блока есть заголовок');
    assert.ok(withHeader.every((s) => s.headerStart! < s.open), 'заголовок непуст');

    // сквозной прогон: вставка перед закрывашкой второй функции
    const md = hatchMd(
      [{ match: `...\n${c.header}\n...\n${c.body}\n>>>\n...`, patch: '\n  c();' }],
      c.lang,
    );
    const { source, edits } = applyAll(c.source, parseHatchFile(md), adapter);
    assert.equal(edits.length, 1);
    const at = source.indexOf('c();');
    assert.ok(at > source.indexOf(c.body), 'правка после якоря тела');
    assert.ok(at > source.indexOf('first'), 'правка во ВТОРОЙ функции');
  });

  test(`${c.lang}: generate round-trip (synth → .md → apply == new version)`, async () => {
    const adapter = adapterForLanguage(c.lang);
    await adapter.init();
    // одна правка в теле ВТОРОЙ функции: якорь обязан отличить её от первой
    const changed = c.source.replace(c.body, c.body.replace('b', 'z'));
    assert.notEqual(changed, c.source);
    const md = printHatchFile(synthesize(c.source, changed, adapter), c.lang);
    assert.equal(applyAll(c.source, parseHatchFile(md), adapter).source, changed);
  });
}

test('the whole registry is initialized: no broken paths to the .wasm', async () => {
  for (const c of CASES) await adapterForLanguage(c.lang).init();
  await adapterForLanguage('python').init();
});
