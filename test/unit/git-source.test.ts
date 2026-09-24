import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { fileFromGit } from '../../src/infra/git.ts';
import type { GitSource } from '../../src/infra/git.ts';
import { GitError } from '../../src/core/errors.ts';
import { buildRepo, version, OTHER, SIDE_ONLY } from '../git-repo.ts';

// The repository and what each coordinate points at: see test/git-repo.ts.

const R = buildRepo('hatch-git-source-');
after(() => rmSync(R.dir, { recursive: true, force: true }));

interface Case {
  readonly name: string;
  readonly source: GitSource;
  readonly text?: string;
  readonly error?: readonly RegExp[];
}

// Every combination of the three coordinates, each one pointing at something that is
// there and at something that is not — the table IS the specification.
const CASES: readonly Case[] = [
  // ── all three defaulted, and one coordinate at a time ──────────────────────
  { name: 'nothing named: the last commit of the branch we are on, the path of --in',
    source: {}, text: version(2) },
  { name: 'branch alone: the last commit of THAT branch',
    source: { branch: 'side' }, text: version(3) },
  { name: 'branch alone: the branch we are on, spelled out, is the default',
    source: { branch: R.branch }, text: version(2) },
  { name: 'branch alone: a remote-tracking branch counts as a branch',
    source: { branch: 'origin/main' }, text: version(2) },
  { name: 'commit alone: that commit, the same file',
    source: { commit: R.a }, text: version(1) },
  { name: 'commit alone: the tip commit itself',
    source: { commit: R.b }, text: version(2) },
  { name: 'commit alone: a tag is a perfectly good commit',
    source: { commit: 'v1.0' }, text: version(2) },
  { name: 'commit alone: any revision git understands, HEAD~1 included',
    source: { commit: 'HEAD~1' }, text: version(1) },
  { name: 'path alone: another file, out of the same commit',
    source: { path: 'src/core/other.cc' }, text: OTHER },
  { name: 'path alone: an absolute path inside the repository',
    source: { path: join(R.dir, 'src', 'core', 'other.cc') }, text: OTHER },

  // ── two and three coordinates together ─────────────────────────────────────
  { name: 'branch + commit: a commit that branch holds',
    source: { branch: R.branch, commit: R.a }, text: version(1) },
  { name: 'branch + commit: the fork point, held by both branches',
    source: { branch: 'side', commit: R.a }, text: version(1) },
  { name: 'branch + commit: a commit only that branch holds',
    source: { branch: 'side', commit: R.s }, text: version(3) },
  { name: 'branch + path: a file that exists only on that branch',
    source: { branch: 'side', path: 'src/core/side-only.cc' }, text: SIDE_ONLY },
  { name: 'commit + path: another file, out of an older commit',
    source: { commit: R.a, path: 'src/core/other.cc' }, text: OTHER },
  { name: 'all three at once',
    source: { branch: 'side', commit: R.s, path: 'src/core/side-only.cc' }, text: SIDE_ONLY },

  // ── coordinates that name nothing ──────────────────────────────────────────
  { name: 'unknown branch',
    source: { branch: 'nope' }, error: [/--branch nope/, /no such branch/] },
  { name: 'unknown commit',
    source: { commit: 'nope' }, error: [/--commit nope/, /no such commit/] },
  { name: 'unknown path',
    source: { path: 'nope.cc' }, error: [/--repo-path nope\.cc/, /no such file in HEAD/] },
  { name: 'a path that exists, but not in THIS commit',
    source: { path: 'src/core/side-only.cc' }, error: [/--repo-path/, /no such file in HEAD/] },
  { name: 'a path that exists in the commit named, but not in the branch named',
    source: { branch: R.branch, path: 'src/core/side-only.cc' }, error: [/no such file/] },

  // ── coordinates that name the wrong KIND of thing ──────────────────────────
  { name: 'a tag is not a branch, and the refusal says which flag takes one',
    source: { branch: 'v1.0' }, error: [/--branch v1\.0/, /not a branch/, /refs\/tags\/v1\.0/, /--commit/] },
  { name: 'a raw sha is not a branch either',
    source: { branch: R.b }, error: [/not a branch/, /no ref at all/, /--commit/] },
  { name: 'a directory is not a file: a tree is refused, not printed as a listing',
    source: { path: 'src/core' }, error: [/--repo-path src\/core/, /not a file/, /tree/] },
  { name: 'a path outside the repository',
    source: { path: '../../etc/passwd' }, error: [/--repo-path/, /outside its repository root/] },

  // ── the combination that can contradict itself ─────────────────────────────
  { name: 'branch + commit: a commit that branch never held',
    source: { branch: R.branch, commit: R.s },
    error: [new RegExp(`commit ${R.s} is not on branch ${R.branch}`), /--branch/, /--commit/] },
  { name: 'commit alone stands on its own: no branch is named, so none is checked',
    source: { commit: R.s }, text: version(3) },

  // ── which coordinate is judged first ───────────────────────────────────────
  { name: 'the branch is judged before the commit',
    source: { branch: 'nope', commit: 'alsonope' }, error: [/--branch nope/] },
  { name: 'the commit is judged before the path',
    source: { commit: 'nope', path: 'nope.cc' }, error: [/--commit nope/] },
  { name: 'branch and commit both fit, and only then is the path judged',
    source: { branch: R.branch, commit: R.a, path: 'nope.cc' }, error: [/--repo-path nope\.cc/] },
];

for (const c of CASES) {
  test(`git source — ${c.name}`, async () => {
    if (c.text !== undefined) {
      assert.equal((await fileFromGit(c.source, R.inPath)).text, c.text);
      return;
    }
    // A refusal is judged by what it SAYS: a named error, and the flag to change in it.
    await assert.rejects(
      () => fileFromGit(c.source, R.inPath),
      (e: unknown) => {
        assert.ok(e instanceof GitError, `expected GitError, got ${String(e)}`);
        for (const fragment of c.error ?? []) assert.match(e.message, fragment);
        return true;
      },
    );
  });
}

test('git source: the spec says exactly what was read', async () => {
  assert.equal((await fileFromGit({}, R.inPath)).spec, 'HEAD:src/core/f.cc');
  assert.equal((await fileFromGit({ branch: 'side' }, R.inPath)).spec, 'side:src/core/f.cc');
  assert.equal((await fileFromGit({ commit: R.a }, R.inPath)).spec, `${R.a}:src/core/f.cc`);
  assert.equal(
    (await fileFromGit({ path: 'src/core/other.cc' }, R.inPath)).spec,
    'HEAD:src/core/other.cc',
  );
});

test('git source: outside a repository, before any coordinate is looked at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-norepo-'));
  try {
    writeFileSync(join(dir, 'f.cc'), version(4));
    await assert.rejects(() => fileFromGit({ branch: 'main' }, join(dir, 'f.cc')), (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /needs a git repository/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git source: a .git that git itself cannot read is named as that, not as a missing branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-broken-'));
  try {
    writeFileSync(join(dir, '.git'), 'gitdir: nowhere-at-all\n');
    writeFileSync(join(dir, 'f.cc'), version(4));
    await assert.rejects(() => fileFromGit({ branch: 'main' }, join(dir, 'f.cc')), (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /cannot run git/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git source: a repository with no commits yet says so, and does not blame the path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-git-empty-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(join(dir, 'f.cc'), version(4));
    await assert.rejects(() => fileFromGit({}, join(dir, 'f.cc')), (e: unknown) => {
      assert.ok(e instanceof GitError);
      assert.match(e.message, /no commits yet/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
