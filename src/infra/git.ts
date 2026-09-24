import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { GitError } from '../core/errors.ts';
import { findRepoRoot } from './fs.ts';

// The old version taken out of git is named by three INDEPENDENT coordinates, and
// every one of them may be left out — what is missing takes its default:
//
//   branch  → the branch we are on             (--branch)
//   commit  → the last commit of that branch   (--commit)
//   path    → the path of --in in the repo     (--repo-path)
//
// A commit names a version on its own, so a commit alone is taken as given. The branch
// beside it is a CLAIM about that commit — and a claim is worth checking, which is why
// the two together are the one combination that can be refused.
//
// ── the one rule this module is built around ─────────────────────────────────────
//
// simple-git calls a task failed when the exit code is non-zero AND git wrote to
// stderr (its documented behaviour), and the error it finally throws is its own —
// nothing a plugin attaches to it survives. So a git command that answers with an
// EXIT CODE and stays silent (`merge-base --is-ancestor`, `rev-parse --quiet`) reports
// its "no" as a success here, and there is no supported way to read the code back.
//
// Therefore: no check below depends on an exit code. Every question is put to git in a
// form that answers through OUTPUT — a sha to compare, a name to read, bytes to hand
// back — and `attempt` treats "no output" and "refused" as the same, ordinary "no".

export interface GitSource {
  readonly branch?: string | undefined;
  readonly commit?: string | undefined;
  readonly path?: string | undefined;
}

export interface GitVersion {
  readonly text: string;
  /** `<revision>:<path>` — what was actually read, for messages and logs. */
  readonly spec: string;
}

const BRANCH = '--branch';
const COMMIT = '--commit';
const REPO_PATH = '--repo-path';

export async function fileFromGit(source: GitSource, inPath: string): Promise<GitVersion> {
  const abs = resolve(inPath);
  const root = repoRootFor(dirname(abs));
  const git = gitAt(root);
  await mustRunGit(git, root);

  const path = repoPath(source, abs, root);
  const revision = await revisionOf(git, source, root);
  return { text: await blob(git, revision, path, root), spec: `${revision}:${path.value}` };
}

// ── where ────────────────────────────────────────────────────────────────────────

function repoRootFor(from: string): string {
  const root = findRepoRoot(from);
  if (root !== undefined) return root;
  throw new GitError(
    `the old version from git needs a git repository, and no directory with .git was found above ${from}`,
  );
}

/** A coordinate as the reader spelled it, next to the flag that carried it — so a
 *  refusal can name the argument to change instead of leaking a raw git message. */
interface Coordinate {
  readonly value: string;
  readonly flag: string;
}

function repoPath(source: GitSource, inAbs: string, root: string): Coordinate {
  if (source.path === undefined) return { value: within(root, inAbs, '--in'), flag: '--in' };
  // A path INSIDE the repository, so a relative one is measured from the root, the way
  // git measures it, and never from the current directory.
  const abs = isAbsolute(source.path) ? source.path : join(root, source.path);
  return { value: within(root, abs, REPO_PATH), flag: REPO_PATH };
}

function within(root: string, abs: string, flag: string): string {
  const inside = relative(root, abs);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new GitError(`${flag}: ${abs} is outside its repository root ${root}`);
  }
  return inside.split(sep).join('/');
}

// ── which version ────────────────────────────────────────────────────────────────

/** A revision to hand to git, and the words to call it by in a message. */
interface Revision {
  readonly rev: string;
  readonly label: string;
}

async function revisionOf(git: SimpleGit, source: GitSource, root: string): Promise<string> {
  if (source.commit === undefined) return (await branchRevision(git, source.branch, root)).rev;

  // A named branch is judged first — coordinates are read in the order they are written
  // — but it is only a claim ABOUT the commit, so with no branch there is nothing to
  // check against and the commit is taken as given.
  const branch = source.branch === undefined ? undefined : await branchRevision(git, source.branch, root);
  const commit = await commitOf(git, source.commit, root);
  if (branch !== undefined) await mustContain(git, branch, commit, root);
  return commit.spelled;
}

async function branchRevision(git: SimpleGit, branch: string | undefined, root: string): Promise<Revision> {
  if (branch === undefined) {
    if (await shaOf(git, 'HEAD') === undefined) {
      throw new GitError(`the repository ${root} has no commits yet, so there is no old version to take`);
    }
    return { rev: 'HEAD', label: 'the branch we are on' };
  }

  const ref = await refName(git, branch);
  if (ref === undefined) throw new GitError(`${BRANCH} ${branch}: no such branch in ${root}`, branch);
  if (!ref.startsWith('refs/heads/') && !ref.startsWith('refs/remotes/')) {
    throw new GitError(
      `${BRANCH} ${branch}: not a branch, it names ${ref === '' ? 'no ref at all' : ref}` +
        ` — for any other revision use ${COMMIT}`,
      branch,
    );
  }
  return { rev: branch, label: `branch ${branch}` };
}

/** A commit as git resolved it, next to the way the reader spelled it — the sha is what
 *  a comparison needs, the spelling is what a message has to quote back. */
interface Commit {
  readonly sha: string;
  readonly spelled: string;
}

async function commitOf(git: SimpleGit, spelled: string, root: string): Promise<Commit> {
  const sha = await shaOf(git, spelled);
  if (sha === undefined) throw new GitError(`${COMMIT} ${spelled}: no such commit in ${root}`, spelled);
  return { sha, spelled };
}

/** Both coordinates named is the one combination that can contradict itself: a commit
 *  the branch never held would quietly hand back a version out of another history.
 *  Containment is read as `merge-base(commit, branch) === commit`, the same statement
 *  `--is-ancestor` makes — but as an ANSWER, not an exit code (see the note above). */
async function mustContain(git: SimpleGit, branch: Revision, commit: Commit, root: string): Promise<void> {
  if ((await attempt(git, ['merge-base', commit.sha, branch.rev]))?.trim() === commit.sha) return;
  throw new GitError(
    `commit ${commit.spelled} is not on ${branch.label} (repository ${root})\n` +
      `  name the branch that holds it with ${BRANCH}, or drop ${COMMIT}`,
    commit.spelled,
  );
}

// ── the bytes ────────────────────────────────────────────────────────────────────

/** `cat-file blob` rather than `show`: it costs the same single call and REFUSES a
 *  directory, which `show` would hand back as a printed tree listing — a "file" that
 *  looks like content and is not. The revision is verified by the time we are here, so
 *  a refusal at this point is always about the path, and can say so. */
async function blob(git: SimpleGit, revision: string, path: Coordinate, root: string): Promise<string> {
  const spec = `${revision}:${path.value}`;
  const text = await attempt(git, ['cat-file', 'blob', spec]);
  if (text !== undefined) return text;

  const kind = (await attempt(git, ['cat-file', '-t', spec]))?.trim();
  throw new GitError(
    kind === undefined || kind === ''
      ? `${path.flag} ${path.value}: no such file in ${revision} (repository ${root})`
      : `${path.flag} ${path.value}: not a file in ${revision} — git calls it a ${kind}`,
    revision,
  );
}

// ── talking to git ───────────────────────────────────────────────────────────────

function gitAt(root: string): SimpleGit {
  // NB: never `trimmed: true` here — this instance reads file CONTENT, and trimming
  // would eat the trailing newline of every old version.
  return simpleGit(root);
}

/** Asked once, before any coordinate is put to git, so that every later "no" is really
 *  git saying no. A `.git` next door proves a repository, never that the binary is
 *  there to read it — and without this, an unrunnable git answers every question with
 *  a confident "no such branch". */
async function mustRunGit(git: SimpleGit, root: string): Promise<void> {
  try {
    await git.raw(['rev-parse', '--git-dir']);
  } catch (e) {
    throw new GitError(`cannot run git in ${root}\n  ${firstLine(e)}`);
  }
}

function firstLine(e: unknown): string {
  return String((e as Error).message ?? '').trim().split('\n')[0] ?? '';
}

/** The output of a command, or undefined when git refused to answer. An EMPTY answer
 *  is NOT a refusal and comes back as `''`: `cat-file blob` on an empty file has to be
 *  told apart from `cat-file blob` on a file that is not there. Callers that do want
 *  the two to mean the same (`shaOf`) say so themselves. */
async function attempt(git: SimpleGit, args: readonly string[]): Promise<string | undefined> {
  try {
    return await git.raw([...args]);
  } catch {
    return undefined;
  }
}

/** The commit a revision names, or undefined when git does not know it. */
async function shaOf(git: SimpleGit, revision: string): Promise<string | undefined> {
  const sha = (await attempt(git, ['rev-parse', '--verify', `${revision}^{commit}`]))?.trim();
  return sha === undefined || sha === '' ? undefined : sha;
}

/** The full ref behind a revision — `refs/heads/x`, `refs/tags/x`, `refs/remotes/x` —
 *  or the empty string when the revision is real but names no ref at all (a raw sha),
 *  or undefined when git does not know it. */
async function refName(git: SimpleGit, revision: string): Promise<string | undefined> {
  return (await attempt(git, ['rev-parse', '--symbolic-full-name', revision]))?.trim();
}
