import { statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { ConfigError } from '../core/errors.ts';
import { findRepoRoot } from './fs.ts';

export interface OutPathInput {
  readonly inPath: string;
  readonly out: string | null;
  readonly mirror?: boolean;
  readonly suffix?: string;
}

export interface OutPath {
  readonly path: string | undefined;
  readonly repoRoot?: string;
}

export function resolveOutPath(input: OutPathInput): OutPath {
  const inPath = resolve(input.inPath);
  const name = `${basename(inPath)}${input.suffix ?? '.md'}`;

  if (input.mirror === true) return mirrored(input, inPath, name);
  if (input.out === null) return { path: join(dirname(inPath), name) };
  if (input.out === '-') return { path: undefined };

  const target = isAbsolute(input.out) ? input.out : join(anchorFor(inPath), input.out);
  return { path: namesDirectory(input.out, target) ? join(target, name) : target };
}

function mirrored(input: OutPathInput, inPath: string, name: string): OutPath {
  if (input.out === null || input.out === '-') {
    throw new ConfigError('generate.mirror needs generate.out to be a directory');
  }

  const repoRoot = findRepoRoot(dirname(inPath));
  if (repoRoot === undefined) {
    throw new ConfigError(
      `generate.mirror measures paths from the repository root, and no directory with .git was found above ${dirname(inPath)}`,
    );
  }

  const within = relative(repoRoot, inPath);
  if (within.startsWith('..') || isAbsolute(within)) {
    throw new ConfigError(`generate.mirror: ${inPath} is outside its repository root ${repoRoot}`);
  }

  const root = isAbsolute(input.out) ? input.out : join(repoRoot, input.out);
  return { path: join(root, dirname(within), name), repoRoot };
}

function anchorFor(inPath: string): string {
  return findRepoRoot(dirname(inPath)) ?? dirname(inPath);
}

function namesDirectory(out: string, target: string): boolean {
  if (/[/\\]$/.test(out)) return true;
  try {
    return statSync(target).isDirectory();
  } catch {
    return extname(basename(out)) === '';
  }
}
