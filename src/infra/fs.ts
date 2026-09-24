import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PathError } from '../core/errors.ts';

const REPO_MARKER = '.git';

export function readInputFile(path: string, argument: string): string {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`no such file: ${path} (${argument})`);
  }
  if (!stats.isFile()) throw new Error(`${argument} takes a file, and ${path} is a directory`);
  return readFileSync(path, 'utf8');
}

export function writeFileAtomic(path: string, data: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.hatch-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
    }
    throw e;
  }
}

export function ensureParent(path: string): void {
  checkParent(path);
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

export function checkParent(path: string): void {
  const dir = dirname(resolve(path));
  const blocker = firstNonDirectory(dir);
  if (blocker !== undefined) {
    throw new PathError(
      blocker === dir ? `cannot create ${dir}: it is a file` : `cannot create ${dir}: ${blocker} is a file`,
      dir,
      blocker,
    );
  }
}

export function* upwards(startDir: string): Generator<string> {
  let dir = resolve(startDir);
  for (;;) {
    yield dir;
    const parent = dirname(dir);
    if (parent === homedir() || dirname(parent) === parent) return;
    dir = parent;
  }
}

export function findRepoRoot(startDir: string): string | undefined {
  for (const dir of upwards(startDir)) if (isRepoRoot(dir)) return dir;
  return undefined;
}

export function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, REPO_MARKER));
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function firstNonDirectory(dir: string): string | undefined {
  for (const step of [...upwards(dir)].reverse()) {
    try {
      if (!statSync(step).isDirectory()) return step;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
