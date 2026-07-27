// infra/git.ts — достать «старую» версию файла из git-ветки для `generate --branch`.
// Тонкая обёртка над simple-git: `git show <branch>:<path>` отдаёт содержимое блоба.
// Изолировано, чтобы cli/generate не знал про git напрямую и это можно было мокать.
import { simpleGit } from 'simple-git';

/**
 * Содержимое файла relPath из ветки branch репозитория repo (по умолчанию — CWD).
 * relPath — путь ОТНОСИТЕЛЬНО корня репозитория. Бросает, если ветки/файла нет.
 */
export async function fileFromBranch(branch: string, relPath: string, repo = '.'): Promise<string> {
  return simpleGit(repo).show([`${branch}:${relPath}`]);
}
