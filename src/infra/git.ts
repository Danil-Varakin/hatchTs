import { simpleGit } from 'simple-git';

export async function fileFromBranch(branch: string, relPath: string, repo = '.'): Promise<string> {
  return simpleGit(repo).show([`${branch}:${relPath}`]);
}
