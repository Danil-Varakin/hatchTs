import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { applyAll } from '../../src/core/apply.ts';
import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { adapterForLanguage, adapterForFile } from '../../src/lang/adapter.ts';
import { hatchMd } from '../helpers.ts';
import type { SourceMap } from '../../src/lang/source-map.ts';

// depthAt / enclosingEnd жили в SourceMap, но в src/ их не звал никто — только тесты.
// Оба выводятся из enclosing(), который возвращает спаны от самого внутреннего.
const depthAt = (map: SourceMap, pos: number): number => map.enclosing(pos).length;
const enclosingEnd = (map: SourceMap, pos: number): number => map.enclosing(pos)[0]?.close ?? map.eof;


interface Case {
  lang: string;
  file: string;
  source: string;
  header: string;
  body: string;
}

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

    await adapter.init();

    const map = adapter.buildMap(c.source);
    const canon = adapter.normalize(c.source);
    const inBody = canon.indexOf(adapter.normalize(c.body));
    assert.notEqual(inBody, -1);
    assert.ok(depthAt(map, inBody) >= 1, `depth ${depthAt(map, inBody)}`);
    const spans = map.enclosing(inBody);
    assert.ok(spans.length >= 1, 'the body of a function is a block');
    const withHeader = spans.filter((s) => s.headerStart !== undefined);
    assert.ok(withHeader.length >= 1, 'the block has a header');
    assert.ok(withHeader.every((s) => s.headerStart! < s.open), 'the header is not empty');

    const md = hatchMd(
      [{ match: `...\n${c.header}\n...\n${c.body}\n>>>\n...`, patch: '\n  c();' }],
      c.lang,
    );
    const { source, edits } = applyAll(c.source, parseHatchFile(md), adapter);
    assert.equal(edits.length, 1);
    const at = source.indexOf('c();');
    assert.ok(at > source.indexOf(c.body), 'the edit lands after the body anchor');
    assert.ok(at > source.indexOf('first'), 'the edit lands in the SECOND function');
  });

  test(`${c.lang}: generate round-trip (synth → .md → apply == new version)`, async () => {
    const adapter = adapterForLanguage(c.lang);
    await adapter.init();
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
