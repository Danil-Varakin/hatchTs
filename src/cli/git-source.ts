import { fileFromGit } from '../infra/git.ts';
import type { Ask } from '../infra/ask.ts';
import type { ArgSpec } from './args.ts';

// Taking a file out of git, as every command that reads one spells it. The flags, their
// help and the way they become a request to infra/git.ts live here once, so `generate`
// (the old version) and `apply` (the file to patch) cannot drift apart: the same words
// mean the same version in both.

/** The git coordinates as a command's options carry them. */
export interface GitOptions {
  head: boolean;
  branch?: string;
  commit?: string;
  repoPath?: string;
}

/** A version of a file: its text, and where it was read from — a path on disk, or
 *  `<revision>:<path>` out of git. Kept for the error report: an error deep in the run
 *  points into this text, and the reader has to be told which text it is. */
export interface FileVersion {
  readonly text: string;
  readonly spec: string;
}

export const GIT_FLAG_NAMES = '--head / --branch / --commit / --repo-path';

/** Spread into a command's ArgSpec. */
export const GIT_ARGS = {
  flags: { '--head': 'head', '-H': 'head' },
  values: {
    '--branch': 'branch', '-b': 'branch',
    '--commit': 'commit', '-c': 'commit',
    '--repo-path': 'repoPath',
  },
} as const satisfies ArgSpec<GitOptions>;

export function asksGit(opts: GitOptions): boolean {
  return opts.head || opts.branch !== undefined || opts.commit !== undefined || opts.repoPath !== undefined;
}

export function readFromGit(opts: GitOptions, inPath: string, ask?: Ask): Promise<FileVersion> {
  return fileFromGit({ branch: opts.branch, commit: opts.commit, path: opts.repoPath }, inPath, ask);
}

/** The coordinates explained, for a command's USAGE; "it" is whatever that command
 *  reads from git, and the command says what that is in the line above. */
export const GIT_USAGE = `From git it is named by three independent coordinates, and every one of them may be
left out: what is missing takes its default, so --head alone means "this same file,
as of the last commit here". Naming any coordinate is itself the ask for git.

  --head,   -H            read it from git. On its own that is every coordinate
                          defaulted: current branch, its last commit, the path of
                          --in; beside the others it is simply the ask for git
  --branch, -b <branch>   which branch (default: the one we are on). Alone it means
                          the last commit of that branch. A BRANCH, local or remote-
                          tracking: a tag or a raw sha belongs in --commit, and given
                          here it is asked about before being read as one (--yes)
  --commit, -c <commit>   which commit (default: the last one of that branch). Any
                          revision git understands: a sha, a tag, HEAD~3. A commit
                          names a version on its own and is taken as given; named
                          TOGETHER with --branch it should be one that branch holds —
                          when it is not, you are asked before a version out of
                          another history is read (--yes)
  --repo-path  <path>     which file, named INSIDE THE REPOSITORY (default: the path
                          of --in). A path git knows, not a path on disk: a relative
                          one is measured from the repository root, never from the
                          current directory`;
