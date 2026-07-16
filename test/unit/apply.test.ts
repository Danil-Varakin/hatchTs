import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { applyAll } from '../../src/cli/apply.ts';

// ── applyAll: чистое ядро (без файлов) ────────────────────────────────────────

test('applyAll: один ханк-вставка меняет текст', async () => {
  await cppAdapter.init();
  const file = parseHatchFile(
    ['# match', '```cpp', '... a(); >>> ...', '```', '# patch', '```cpp', 'X();', '```'].join('\n'),
  );
  const { source, edits } = applyAll('void f(){ a(); b(); }', file, cppAdapter);
  assert.equal(edits.length, 1);
  assert.ok(source.includes('a();X(); b();'), source);
});

test('applyAll: второй ханк цепляется за вставку первого (последовательность)', async () => {
  await cppAdapter.init();
  const md = [
    '# match', '```cpp', '... namespace f { >>> ...', '```', '# patch', '```cpp', 'int a;', '```',
    '# match', '```cpp', '... int a; >>> ...', '```', '# patch', '```cpp', 'int b;', '```',
  ].join('\n');
  const file = parseHatchFile(md);
  const { source, edits } = applyAll('namespace f {\n}\n', file, cppAdapter);
  assert.equal(edits.length, 2); // оба применились
  // второй ханк нашёл 'int a;', вставленный первым, — против исходника его там не было
  assert.ok(source.includes('int a;') && source.includes('int b;'), source);
  assert.ok(source.indexOf('int a;') < source.indexOf('int b;'), source);
});

// ── CLI end-to-end: коды выхода и запись файла ────────────────────────────────

const CLI = fileURLToPath(new URL('../../src/cli/apply.ts', import.meta.url));

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI apply: успех (exit 0) и файл записан', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    const out = join(dir, 'out.cc');
    writeFileSync(src, 'void f(){ a(); b(); }');
    writeFileSync(md, ['# match', '```cpp', '... a(); >>> ...', '```', '# patch', '```cpp', 'X();', '```'].join('\n'));

    const r = runCli(['--match', md, '--in', src, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(out, 'utf8').includes('a();X();'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply --verify: патч ложится чисто → exit 0, файл не пишется', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    writeFileSync(src, 'void f(){ a(); b(); }');
    writeFileSync(md, ['# match', '```cpp', '... a(); >>> ...', '```', '# patch', '```cpp', 'X();', '```'].join('\n'));

    const r = runCli(['--match', md, '--in', src, '--verify']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /verify: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply: нет совпадения → exit 3 (MatchError)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    writeFileSync(src, 'void f(){ a(); }');
    writeFileSync(md, ['# match', '```cpp', '... nope(); >>> ...', '```', '# patch', '```cpp', 'X();', '```'].join('\n'));

    const r = runCli(['--match', md, '--in', src, '--out', join(dir, 'o.cc')]);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /MatchError/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
