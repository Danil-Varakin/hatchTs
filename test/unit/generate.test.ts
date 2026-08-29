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
import { cppAdapter } from '../../src/lang/cpp/index.ts';

// ── the round trip THROUGH .md: synth → print → parse → apply == new ──────────

async function pipelineRoundtrip(oldStr: string, newStr: string): Promise<void> {
  await cppAdapter.init();
  const md = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  const { source } = applyAll(oldStr, parseHatchFile(md), cppAdapter);
  assert.equal(source, newStr);
}

test('printer round trip: a replacement', async () => {
  await pipelineRoundtrip(
    'namespace net {\nvoid Fetch() {\n  int timeout = 30;\n  Connect(timeout);\n}\n}\n',
    'namespace net {\nvoid Fetch() {\n  int timeout = 60;\n  Connect(timeout);\n}\n}\n',
  );
});

test('printer round trip: insertion, deletion and several hunks', async () => {
  await pipelineRoundtrip(
    'void f() {\n  a();\n  b();\n  c();\n}\n',
    'void f() {\n  a();\n  X();\n  c();\n  d();\n}\n',
  );
});

test('printer round trip: a literal holding ... is escaped and survives parsing', async () => {
  await pipelineRoundtrip('int a = f(x, y);\nint z = 0;\n', 'int a = f(x, ...);\nint z = 0;\n');
});

test('printHatchFile: the parser reads back the headings it writes', async () => {
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

// ── agreement: keeping only the hunks that were confirmed ─────────────────────

test('reviewHunks keeps only what was confirmed', async () => {
  const hunks = [
    { match: { steps: [] }, patch: 'a' },
    { match: { steps: [] }, patch: 'b' },
    { match: { steps: [] }, patch: 'c' },
  ];
  let i = 0;
  const kept = await reviewHunks(hunks, async () => i++ !== 1);
  assert.deepEqual(kept.map((h) => h.patch), ['a', 'c']);
});

// ── CLI generate end to end, and apply back again ─────────────────────────────

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

test('CLI generate --in-old writes the .md, and apply brings the new file back', () => {
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

test('CLI generate: with and without --out the name is <name of --in>.md', () => {
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
    assert.equal(g3.status, 0, g3.stderr);
    assert.match(readFileSync(join(dir, 'nope', 'in.cc.md'), 'utf8'), /# match/, 'the directory is created');

    const asDir = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', join(dir, 'patches'), '--language', 'cpp']);
    assert.equal(asDir.status, 0, asDir.stderr);
    assert.match(
      readFileSync(join(dir, 'patches', 'in.cc.md'), 'utf8'),
      /# match/,
      'a name without an extension is a directory, not a file called that',
    );

    const named = join(dir, 'deep', 'named.md');
    const g5 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', named, '--language', 'cpp']);
    assert.equal(g5.status, 0, g5.stderr);
    assert.match(readFileSync(named, 'utf8'), /# match/, 'a path naming a file is written as is');

    const g4 = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--out', '-', '--language', 'cpp']);
    assert.equal(g4.status, 0, g4.stderr);
    assert.match(g4.stdout, /# match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate --branch takes the old version from a git branch', () => {
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

function branchRepo(): { dir: string; branch: string; oldStr: string; newStr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-sub-'));
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['config', 'user.email', 'a@b.c']);
  git(['config', 'user.name', 'test']);
  mkdirSync(join(dir, 'src', 'core'), { recursive: true });
  const oldStr = 'void f() {\n  int a = 1;\n}\n';
  const newStr = 'void f() {\n  int a = 2;\n}\n';
  writeFileSync(join(dir, 'src', 'core', 'f.cc'), oldStr);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'old']);
  writeFileSync(join(dir, 'src', 'core', 'f.cc'), newStr);
  return { dir, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), oldStr, newStr };
}

test('CLI generate --branch works from a SUBDIRECTORY, not only from the repository root', () => {
  const { dir, branch, oldStr, newStr } = branchRepo();
  try {
    const gen = runCli(GEN_CLI, ['--in', 'f.cc', '--branch', branch, '--out', '-', '--language', 'cpp'],
      join(dir, 'src', 'core'));
    assert.equal(gen.status, 0, gen.stderr);

    const md = join(dir, 'patch.md');
    writeFileSync(md, gen.stdout);
    const src = join(dir, 'copy.cc');
    const out = join(dir, 'result.cc');
    writeFileSync(src, oldStr);
    const ap = runCli(APPLY_CLI, ['--match', md, '--in', src, '--out', out]);
    assert.equal(ap.status, 0, ap.stderr);
    assert.equal(readFileSync(out, 'utf8'), newStr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate --branch takes an ABSOLUTE --in as well', () => {
  const { dir, branch } = branchRepo();
  try {
    const gen = runCli(GEN_CLI, [
      '--in', join(dir, 'src', 'core', 'f.cc'), '--branch', branch, '--out', '-', '--language', 'cpp',
    ]);
    assert.equal(gen.status, 0, gen.stderr);
    assert.match(gen.stdout, /^# match cpp/);
    assert.ok(gen.stdout.includes('int a = 2;'), gen.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate --branch outside a repository fails with a named error, not a raw git message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-none-'));
  try {
    writeFileSync(join(dir, 'f.cc'), 'void f() {\n  int a = 2;\n}\n');
    const gen = runCli(GEN_CLI, ['--in', 'f.cc', '--branch', 'main', '--out', '-', '--language', 'cpp'], dir);
    assert.notEqual(gen.status, 0);
    assert.match(gen.stderr, /GitError/);
    assert.match(gen.stderr, /needs a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI generate --mirror: the patch tree repeats the path inside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'hatch-gen-mirror-'));
  try {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'chromium_src', 'browser', 'core'), { recursive: true });
    const oldF = join(root, 'old.cc');
    const newF = join(root, 'chromium_src', 'browser', 'core', 'apdate.cc');
    writeFileSync(oldF, 'void f() {\n  int a = 1;\n}\n');
    writeFileSync(newF, 'void f() {\n  int a = 2;\n}\n');

    const ok = runCli(GEN_CLI, [
      '--in', newF, '--in-old', oldF, '--language', 'cpp', '--mirror', '--out', 'patches',
    ]);
    assert.equal(ok.status, 0, ok.stderr);
    const written = join(root, 'patches', 'chromium_src', 'browser', 'core', 'apdate.cc.md');
    assert.match(readFileSync(written, 'utf8'), /# match/, 'missing directories are created');

    const noOut = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--language', 'cpp', '--mirror']);
    assert.equal(noOut.status, 5, noOut.stderr);
    assert.match(noOut.stderr, /needs an output root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI generate --mirror: a file outside a repository is refused, not guessed at', () => {
  const loose = mkdtempSync(join(tmpdir(), 'hatch-gen-loose-'));
  try {
    const oldF = join(loose, 'old.cc');
    const newF = join(loose, 'in.cc');
    writeFileSync(oldF, 'void f() {\n  int a = 1;\n}\n');
    writeFileSync(newF, 'void f() {\n  int a = 2;\n}\n');

    const r = runCli(GEN_CLI, ['--in', newF, '--in-old', oldF, '--language', 'cpp', '--mirror', '--out', 'patches']);
    assert.equal(r.status, 5, r.stderr);
    assert.match(r.stderr, /no directory with \.git/);
  } finally {
    rmSync(loose, { recursive: true, force: true });
  }
});

test('CLI generate: a plain refusal for a missing input and for a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-gen-in-'));
  try {
    const oldF = join(dir, 'old.cc');
    writeFileSync(oldF, 'void f() {\n  a();\n}\n');
    mkdirSync(join(dir, 'sub'));

    const missing = runCli(GEN_CLI, ['--in', join(dir, 'nope.cc'), '--in-old', oldF, '--language', 'cpp']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /no such file: .*nope\.cc \(--in\)/);

    const isDir = runCli(GEN_CLI, ['--in', join(dir, 'sub'), '--in-old', oldF, '--language', 'cpp']);
    assert.notEqual(isDir.status, 0);
    assert.match(isDir.stderr, /--in takes a file, and .*sub is a directory/);

    const oldIsDir = runCli(GEN_CLI, ['--in', oldF, '--in-old', join(dir, 'sub'), '--language', 'cpp']);
    assert.notEqual(oldIsDir.status, 0);
    assert.match(oldIsDir.stderr, /--in-old takes a file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
