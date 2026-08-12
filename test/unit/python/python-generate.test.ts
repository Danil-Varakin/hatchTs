// Обратный конвейер на Python: synth → printHatchFile → parseHatchFile → apply.
// System-level round trip:
// из двух версий файла родился .md, и его применение к старой версии даёт новую
// ДОСЛОВНО. Для Python это заодно проверка того, что synth живёт без закрывающего
// токена: BlockSpan.closeEnd у питоньего блока НЕТ, закрыть родителя в шаблоне
// нечем — уникальность держат заголовок и соседи.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { synthesize } from '../../../src/generate/synth.ts';
import { printHatchFile } from '../../../src/generate/printer.ts';
import { parseHatchFile } from '../../../src/core/hatch-parser.ts';
import { applyAll } from '../../../src/cli/apply.ts';
import { pythonAdapter } from '../../../src/lang/python/index.ts';

async function roundtrip(oldStr: string, newStr: string): Promise<string> {
  await pythonAdapter.init();
  const md = printHatchFile(synthesize(oldStr, newStr, pythonAdapter), 'python');
  const { source } = applyAll(oldStr, parseHatchFile(md), pythonAdapter);
  assert.equal(source, newStr);
  return md;
}

test('round-trip: replacing a line inside a function body', async () => {
  const md = await roundtrip(
    'def fetch(url):\n    timeout = 30\n    return get(url, timeout)\n',
    'def fetch(url):\n    timeout = 60\n    return get(url, timeout)\n',
  );
  assert.match(md, /^# match python$/m);
});

test('round-trip: inserting a line into a body with an indentation', async () => {
  await roundtrip(
    'def f(x):\n    if x:\n        a()\n    return x\n',
    'def f(x):\n    if x:\n        a()\n        b()\n    return x\n',
  );
});

test('round-trip: an identical edit in one of TWO twin functions', async () => {
  // якорь обязан унести правку в нужную функцию — тут это делает заголовок
  await roundtrip(
    'def first(x):\n    log("a")\n    return x\n\ndef second(x):\n    log("a")\n    return x\n',
    'def first(x):\n    log("a")\n    return x\n\ndef second(x):\n    log("z")\n    return x\n',
  );
});

test('round-trip: deleting a line', async () => {
  await roundtrip(
    'def f():\n    a()\n    b()\n    c()\n',
    'def f():\n    a()\n    c()\n',
  );
});

test('round-trip: a change in the header of a function (the signature itself)', async () => {
  await roundtrip(
    'def f(a):\n    return a\n',
    'def f(a, b=None):\n    return a\n',
  );
});

test('round-trip: an edit at the beginning of a file and at the end of a file', async () => {
  await roundtrip('import os\n\ndef f():\n    return 1\n', 'import sys\n\ndef f():\n    return 1\n');
  await roundtrip('def f():\n    return 1\n', 'def f():\n    return 1\n\ndef g():\n    return 2\n');
});

test('round-trip: a nested block three levels deep', async () => {
  await roundtrip(
    'class C:\n    def m(self):\n        for i in r:\n            work(i)\n        return 0\n',
    'class C:\n    def m(self):\n        for i in r:\n            work(i, fast=True)\n        return 0\n',
  );
});
