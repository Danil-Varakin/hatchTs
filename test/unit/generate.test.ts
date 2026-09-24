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
import { buildRepo, version } from '../git-repo.ts';
import type { Repo } from '../git-repo.ts';

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

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(cli: string, args: string[], cwd?: string): CliRun {
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

// ── the old version from git ─────────────────────────────────────────────────
//
// WHICH version each coordinate names is settled in test/unit/git-source.test.ts,
// against the resolver itself. What is left for the CLI is its own business: that
// every flag reaches the coordinate it belongs to, that the two sources cannot be
// asked for at once, and that a refusal comes out named.

function generateIn(repo: Repo, args: readonly string[], from = join(repo.dir, 'src', 'core')): CliRun {
  return runCli(GEN_CLI, ['--in', 'f.cc', ...args, '--out', '-', '--language', 'cpp'], from);
}

function assertReplaces(md: string, removed: string, added: string): void {
  assert.match(md, new RegExp(`>>>\\n\\s+${removed}\\n\\s+<<<`), md);
  assert.match(md, new RegExp(`# patch\\n\\s+${added}`), md);
}

test('CLI generate --branch works from a SUBDIRECTORY, not only from the repository root', () => {
  const repo = buildRepo('hatch-git-sub-');
  try {
    const gen = generateIn(repo, ['--branch', repo.branch]);
    assert.equal(gen.status, 0, gen.stderr);

    const md = join(repo.dir, 'patch.md');
    writeFileSync(md, gen.stdout);
    const src = join(repo.dir, 'copy.cc');
    const out = join(repo.dir, 'result.cc');
    writeFileSync(src, version(2));
    const ap = runCli(APPLY_CLI, ['--match', md, '--in', src, '--out', out]);
    assert.equal(ap.status, 0, ap.stderr);
    assert.equal(readFileSync(out, 'utf8'), version(4));
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate --branch takes an ABSOLUTE --in as well', () => {
  const repo = buildRepo('hatch-git-abs-');
  try {
    const gen = runCli(GEN_CLI, [
      '--in', repo.inPath, '--branch', repo.branch, '--out', '-', '--language', 'cpp',
    ]);
    assert.equal(gen.status, 0, gen.stderr);
    assert.match(gen.stdout, /^# match cpp/);
    assertReplaces(gen.stdout, 'int a = 2;', 'int a = 4;');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate --head: the old version is the last commit of the current branch', () => {
  const repo = buildRepo('hatch-git-head-');
  try {
    const gen = generateIn(repo, ['--head']);
    assert.equal(gen.status, 0, gen.stderr);
    assertReplaces(gen.stdout, 'int a = 2;', 'int a = 4;');
    assert.equal(generateIn(repo, ['-H']).stdout, gen.stdout, '-H is the same flag');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate: each coordinate flag reaches the coordinate it belongs to', () => {
  const repo = buildRepo('hatch-git-coords-');
  try {
    // All three at once, each naming something only IT can reach: the branch and the
    // commit are `side`, the path is a file no other commit holds. A flag wired to the
    // wrong coordinate cannot produce this answer.
    const all = generateIn(repo, [
      '--branch', 'side', '--commit', repo.s, '--repo-path', 'src/core/side-only.cc',
    ]);
    assert.equal(all.status, 0, all.stderr);
    assert.ok(all.stdout.includes('int side = 1;'), all.stdout);

    const short = generateIn(repo, ['-b', 'side', '-c', repo.s, '--repo-path', 'src/core/side-only.cc']);
    assert.equal(short.stdout, all.stdout, '-b and -c are the same flags');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate: a git refusal comes out named, with a non-zero exit code', () => {
  const repo = buildRepo('hatch-git-refusal-');
  try {
    const off = generateIn(repo, ['--branch', repo.branch, '--commit', repo.s]);
    assert.notEqual(off.status, 0);
    assert.match(off.stderr, /GitError/);
    assert.match(off.stderr, /is not on branch/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate: --in-old and a git coordinate together are refused, and so is neither', () => {
  const repo = buildRepo('hatch-git-both-');
  try {
    for (const args of [['--in-old', 'other.cc', '--head'], ['--in-old', 'other.cc', '-b', 'side'], []]) {
      const r = generateIn(repo, args);
      assert.notEqual(r.status, 0, `expected a refusal for ${args.join(' ')}`);
      assert.match(r.stderr, /exactly one source of the OLD version/);
    }
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate: a source asked for twice, or not at all, is answered by naming both', () => {
  const repo = buildRepo('hatch-cli-source-');
  const old = ['--in-old', join(repo.dir, 'src', 'core', 'other.cc')];
  const cases: readonly (readonly [readonly string[], RegExp])[] = [
    [[...old, '--head'], /exactly one source of the OLD version[\s\S]*not both/],
    [[...old, '-b', 'side'], /not both/],
    [[...old, '-c', repo.a], /not both/],
    [[...old, '--repo-path', 'src/core/other.cc'], /not both/],
    [[...old, '--head', '-b', 'side', '-c', repo.a], /not both/],
    [[], /exactly one source of the OLD version/],
  ];
  try {
    for (const [args, expected] of cases) {
      const r = generateIn(repo, args);
      assert.notEqual(r.status, 0, `expected a refusal for: ${args.join(' ')}`);
      assert.match(r.stderr, expected, `for: ${args.join(' ')}`);
      // The message names every flag involved, so the whole usage is not dumped on top
      // of it — that is kept for a slip of the FINGERS, where the list is the answer.
      assert.doesNotMatch(r.stderr, /hatch generate —/, `for: ${args.join(' ')}`);
    }
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate: a misspelt or valueless option is answered with the option and the usage', () => {
  const repo = buildRepo('hatch-cli-spelling-');
  // generateIn appends `--out - --language cpp`, so an option left without a value here
  // runs into --out — which is exactly the slip being tested.
  const cases: readonly (readonly [readonly string[], RegExp])[] = [
    [['--brnach', 'side'], /unknown argument: --brnach[\s\S]*did you mean --branch\?/],
    [['--repo_path', 'src/core/other.cc'], /did you mean --repo-path\?/],
    [['--heat'], /did you mean --head\?/],
    [['--comit', 'x'], /did you mean --commit\?/],
    [['--head', 'stray'], /unknown argument: stray[\s\S]*a value goes after its option/],
    [['-b'], /option -b needs a value, and --out is another option/],
    [['--commit'], /option --commit needs a value, and --out is another option/],
    [['--repo-path'], /option --repo-path needs a value, and --out is another option/],
  ];
  try {
    for (const [args, expected] of cases) {
      const r = generateIn(repo, args);
      assert.notEqual(r.status, 0, `expected a refusal for: ${args.join(' ')}`);
      assert.match(r.stderr, expected, `for: ${args.join(' ')}`);
      assert.match(r.stderr, /hatch generate —/, `the usage follows a slip: ${args.join(' ')}`);
    }
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate --head sits beside the coordinates rather than fighting them', () => {
  const repo = buildRepo('hatch-cli-head-with-');
  try {
    const withHead = generateIn(repo, ['--head', '--repo-path', 'src/core/side-only.cc', '--branch', 'side']);
    const without = generateIn(repo, ['--repo-path', 'src/core/side-only.cc', '--branch', 'side']);
    assert.equal(withHead.status, 0, withHead.stderr);
    assert.equal(withHead.stdout, without.stdout, '--head asks for git, the coordinates say which version');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('CLI generate --head outside a repository fails with a named error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-nohead-'));
  try {
    writeFileSync(join(dir, 'f.cc'), version(4));
    const gen = runCli(GEN_CLI, ['--in', 'f.cc', '--head', '--out', '-', '--language', 'cpp'], dir);
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
