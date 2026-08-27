import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { reviewHunks } from '../../src/generate/agreement.ts';
import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { applyAll } from '../../src/core/apply.ts';
import { resolveOutPath } from '../../src/cli/generate.ts';
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

test('resolveOutPath: файл как есть, директория и опущенный --out → <имя --in>.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-out-'));
  try {
    assert.equal(resolveOutPath(join(dir, 'patch.md'), join(dir, 'in.cpp')), join(dir, 'patch.md'));
    assert.equal(resolveOutPath(dir, join(dir, 'in.cpp')), join(dir, 'in.cpp.md'));
    assert.equal(resolveOutPath(`${dir}/sub/`, join(dir, 'in.cpp')), join(dir, 'sub', 'in.cpp.md'));
    assert.equal(resolveOutPath(undefined, join(dir, 'in.cpp')), join(dir, 'in.cpp.md'));
    assert.equal(resolveOutPath(undefined, 'in.cpp'), 'in.cpp.md');
    assert.equal(resolveOutPath('-', join(dir, 'in.cpp')), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate: --out = директория и без --out кладут <имя --in>.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-gen-out-'));
  try {
    const oldF = join(dir, 'old.cc');
    const newF = join(dir, 'in.cc');
    writeFileSync(oldF, 'void f() {\n  int a = 1;\n}\n');
    writeFileSync(newF, 'void f() {\n  int a = 2;\n}\n');

    const g1 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--language', 'cpp']);
    assert.equal(g1.status, 0, g1.stderr);
    assert.match(readFileSync(join(dir, 'in.cc.md'), 'utf8'), /# match/);

    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const g2 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', sub, '--language', 'cpp']);
    assert.equal(g2.status, 0, g2.stderr);
    assert.match(readFileSync(join(sub, 'in.cc.md'), 'utf8'), /# match/);

    const g3 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', `${dir}/nope/`, '--language', 'cpp']);
    assert.notEqual(g3.status, 0);
    assert.match(g3.stderr, /no such directory/);

    const g4 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', '-', '--language', 'cpp']);
    assert.equal(g4.status, 0, g4.stderr);
    assert.match(g4.stdout, /# match/);
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
    writeFileSync(join(dir, rel), newStr);

    const md = join(dir, 'patch.md');
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const gen = runCli(GEN_CLI, ['--in', rel, '--branch', branch, '--out', md, '--language', 'cpp'], dir);
    assert.equal(gen.status, 0, gen.stderr);

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
