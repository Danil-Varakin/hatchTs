import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { reviewHunks } from '../../src/generate/agreement.ts';
import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { applyAll } from '../../src/cli/apply.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';

// ── round-trip ЧЕРЕЗ .md: synth → printHatchFile → parseHatchFile → apply == new ──

async function pipelineRoundtrip(oldStr: string, newStr: string): Promise<void> {
  await cppAdapter.init();
  const md = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  const { source } = applyAll(oldStr, parseHatchFile(md), cppAdapter);
  assert.equal(source, newStr);
}

test('printer round-trip: замена', async () => {
  await pipelineRoundtrip(
    'namespace net {\nvoid Fetch() {\n  int timeout = 30;\n  Connect(timeout);\n}\n}\n',
    'namespace net {\nvoid Fetch() {\n  int timeout = 60;\n  Connect(timeout);\n}\n}\n',
  );
});

test('printer round-trip: вставка + удаление + несколько ханков', async () => {
  await pipelineRoundtrip(
    'void f() {\n  a();\n  b();\n  c();\n}\n',
    'void f() {\n  a();\n  X();\n  c();\n  d();\n}\n',
  );
});

test('printer round-trip: литерал с оператором ... экранируется и переживает parse', async () => {
  // многоточие внутри кода не должно спутаться с оператором пропуска
  await pipelineRoundtrip('int a = f(x, y);\nint z = 0;\n', 'int a = f(x, ...);\nint z = 0;\n');
});

test('printHatchFile: структура заголовков читается парсером', async () => {
  await cppAdapter.init();
  const md = printHatchFile(synthesize('int a = 1;\n', 'int a = 2;\n', cppAdapter), 'cpp');
  assert.match(md, /^# match cpp$/m);
  assert.match(md, /^# patch$/m);
  assert.match(md, /^# end$/m);
  assert.match(md, /^ {4}int a = 2;$/m);
  const file = parseHatchFile(md);
  assert.equal(file.hunks.length, 1);
  assert.equal(file.language, 'cpp');
});

// ── agreement: отбор подтверждённых ханков ────────────────────────────────────────

test('reviewHunks оставляет только подтверждённые', async () => {
  const hunks = [
    { match: { steps: [] }, patch: 'a' },
    { match: { steps: [] }, patch: 'b' },
    { match: { steps: [] }, patch: 'c' },
  ];
  // подтверждаем всё, кроме второго
  let i = 0;
  const kept = await reviewHunks(hunks, async () => i++ !== 1);
  assert.deepEqual(kept.map((h) => h.patch), ['a', 'c']);
});

// ── CLI generate end-to-end (+ apply обратно) ─────────────────────────────────────

const GEN_CLI = fileURLToPath(new URL('../../src/cli/generate.ts', import.meta.url));
const APPLY_CLI = fileURLToPath(new URL('../../src/cli/apply.ts', import.meta.url));

function runCli(cli: string, args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', cli, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(cwd !== undefined ? { cwd } : {}),
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('CLI generate --in-old → .md, затем apply даёт new', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-gen-'));
  try {
    const oldF = join(dir, 'old.cc');
    const newF = join(dir, 'new.cc');
    const md = join(dir, 'patch.md');
    const oldStr = 'void f() {\n  int a = 1;\n  return a;\n}\n';
    const newStr = 'void f() {\n  int a = 2;\n  return a;\n}\n';
    writeFileSync(oldF, oldStr);
    writeFileSync(newF, newStr);

    const gen = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', md, '--language', 'cpp']);
    assert.equal(gen.status, 0, gen.stderr);

    const out = join(dir, 'result.cc');
    const ap = runCli(APPLY_CLI, ['--match', md, '--in', oldF, '--out', out]);
    assert.equal(ap.status, 0, ap.stderr);
    assert.equal(readFileSync(out, 'utf8'), newStr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate --branch берёт старую версию из git-ветки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-'));
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    git(['config', 'user.email', 'a@b.c']);
    git(['config', 'user.name', 'test']);

    const rel = 'f.cc';
    const oldStr = 'void f() {\n  int a = 1;\n}\n';
    const newStr = 'void f() {\n  int a = 2;\n}\n';
    writeFileSync(join(dir, rel), oldStr);
    git(['add', rel]);
    git(['commit', '-q', '-m', 'old']);
    writeFileSync(join(dir, rel), newStr); // рабочая копия = new

    const md = join(dir, 'patch.md');
    // запускаем из корня репозитория; --in путь относительный, --branch = текущая ветка
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const gen = runCli(GEN_CLI, ['--in', rel, '--branch', branch, '--out', md, '--language', 'cpp'], dir);
    assert.equal(gen.status, 0, gen.stderr);

    // патч из diff(old,new) применяем к КОПИИ old → должно получиться new
    const oldCopy = join(dir, 'oldcopy.cc');
    const out = join(dir, 'result.cc');
    writeFileSync(oldCopy, oldStr);
    const ap = runCli(APPLY_CLI, ['--match', md, '--in', oldCopy, '--out', out]);
    assert.equal(ap.status, 0, ap.stderr);
    assert.equal(readFileSync(out, 'utf8'), newStr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
