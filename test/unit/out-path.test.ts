import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveOutPath } from '../../src/infra/out-path.ts';
import { ensureParent } from '../../src/infra/fs.ts';
import { ConfigError, PathError } from '../../src/core/errors.ts';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'hatch-out-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'chromium_src', 'browser', 'core'), { recursive: true });
  writeFileSync(join(root, 'chromium_src', 'browser', 'core', 'apdate.cc'), 'void a(){}\n');
  return root;
}

const IN = (root: string): string => join(root, 'chromium_src', 'browser', 'core', 'apdate.cc');

test('without --out the patch lands next to its file', () => {
  const root = repo();
  try {
    const { path } = resolveOutPath({ inPath: IN(root), out: null, mirror: false });
    assert.equal(path, `${IN(root)}.md`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a plain --out: a directory receives the name, any other path is used as is', () => {
  const root = repo();
  try {
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: join(root, 'patch.md') }).path,
      join(root, 'patch.md'),
    );
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: `${join(root, 'flat')}/` }).path,
      join(root, 'flat', 'apdate.cc.md'),
    );
    mkdirSync(join(root, 'existing'));
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: join(root, 'existing') }).path,
      join(root, 'existing', 'apdate.cc.md'),
    );
    assert.equal(resolveOutPath({ inPath: IN(root), out: '-' }).path, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a relative --out is measured from the repository root even without mirroring', () => {
  const root = repo();
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: 'out/' }).path,
      join(root, 'out', 'apdate.cc.md'),
    );
    assert.equal(resolveOutPath({ inPath: IN(root), out: 'out/one.md' }).path, join(root, 'out', 'one.md'));
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test('outside a repository a relative --out falls back to the input file, never to cwd', () => {
  const loose = mkdtempSync(join(tmpdir(), 'hatch-loose-'));
  const cwd = process.cwd();
  try {
    mkdirSync(join(loose, 'src'));
    writeFileSync(join(loose, 'src', 'a.cc'), 'void a(){}\n');
    process.chdir(tmpdir());
    assert.equal(
      resolveOutPath({ inPath: join(loose, 'src', 'a.cc'), out: 'out/' }).path,
      join(loose, 'src', 'out', 'a.cc.md'),
    );
  } finally {
    process.chdir(cwd);
    rmSync(loose, { recursive: true, force: true });
  }
});

test('the suffix is the caller\'s: apply writes a source file, generate a .md', () => {
  const root = repo();
  try {
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: 'out/', suffix: '' }).path,
      join(root, 'out', 'apdate.cc'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mirroring rebuilds the path inside the repository under --out', () => {
  const root = repo();
  try {
    const { path, repoRoot } = resolveOutPath({ inPath: IN(root), out: 'patches', mirror: true });
    assert.equal(path, join(root, 'patches', 'chromium_src', 'browser', 'core', 'apdate.cc.md'));
    assert.equal(repoRoot, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a relative --out is measured from the repository root, not the current directory', () => {
  const root = repo();
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    const { path } = resolveOutPath({ inPath: IN(root), out: 'patches', mirror: true });
    assert.equal(path, join(root, 'patches', 'chromium_src', 'browser', 'core', 'apdate.cc.md'));
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test('an absolute --out receives the same mirrored tail', () => {
  const root = repo();
  const elsewhere = mkdtempSync(join(tmpdir(), 'hatch-patches-'));
  try {
    const { path } = resolveOutPath({ inPath: IN(root), out: elsewhere, mirror: true });
    assert.equal(path, join(elsewhere, 'chromium_src', 'browser', 'core', 'apdate.cc.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('mirroring without an output root is refused', () => {
  const root = repo();
  try {
    assert.throws(() => resolveOutPath({ inPath: IN(root), out: null, mirror: true }), ConfigError);
    assert.throws(() => resolveOutPath({ inPath: IN(root), out: '-', mirror: true }), ConfigError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file outside any repository is an error, not a guess', () => {
  const loose = mkdtempSync(join(tmpdir(), 'hatch-loose-'));
  try {
    writeFileSync(join(loose, 'a.cc'), 'void a(){}\n');
    assert.throws(
      () => resolveOutPath({ inPath: join(loose, 'a.cc'), out: 'patches', mirror: true }),
      (e: unknown) => e instanceof ConfigError && /no directory with \.git/.test(e.message),
    );
  } finally {
    rmSync(loose, { recursive: true, force: true });
  }
});

test('the file at the repository root mirrors to the root of the output tree', () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'top.cc'), 'void a(){}\n');
    const { path } = resolveOutPath({ inPath: join(root, 'top.cc'), out: 'patches', mirror: true });
    assert.equal(path, join(root, 'patches', 'top.cc.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a name without an extension is a directory, one with an extension is a file', () => {
  const root = repo();
  try {
    assert.equal(
      resolveOutPath({ inPath: IN(root), out: 'patches' }).path,
      join(root, 'patches', 'apdate.cc.md'),
      'patches is a directory, not a file called that',
    );
    assert.equal(resolveOutPath({ inPath: IN(root), out: 'one.md' }).path, join(root, 'one.md'));
    assert.equal(resolveOutPath({ inPath: IN(root), out: 'deep/one.md' }).path, join(root, 'deep', 'one.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file sitting where a directory is needed is named, not reported as EEXIST', () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'patches'), 'x');
    assert.throws(
      () => ensureParent(join(root, 'patches', 'chromium_src', 'a.cc.md')),
      (e: unknown) =>
        e instanceof PathError &&
        e.exitCode === 1 &&
        e.blocker === join(root, 'patches') &&
        /is a file/.test(e.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureParent creates the whole chain when nothing blocks it', () => {
  const root = repo();
  try {
    ensureParent(join(root, 'a', 'b', 'c', 'x.md'));
    assert.ok(statSync(join(root, 'a', 'b', 'c')).isDirectory());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
