import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { GitError } from '../core/errors.ts';
import { findRepoRoot } from './fs.ts';

export async function fileFromBranch(branch: string, inPath: string): Promise<string> {
  const abs = resolve(inPath);
  const from = dirname(abs);

  const root = findRepoRoot(from);
  if (root === undefined) {
    throw new GitError(`--branch needs a git repository, and no directory with .git was found above ${from}`, branch);
  }

  const within = relative(root, abs);
  if (within.startsWith('..') || isAbsolute(within)) {
    throw new GitError(`${abs} is outside its repository root ${root}`, branch);
  }
  const gitPath = within.split(sep).join('/');

  try {
    return await simpleGit(root).show([`${branch}:${gitPath}`]);
  } catch (e) {
    throw new GitError(
      `cannot read ${gitPath} from '${branch}' (repository ${root})\n  ${(e as Error).message.trim().split('\n')[0] ?? ''}`,
      branch,
    );
  }
}
