import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** Writes through a temp file and a rename, so a run cut short never leaves half a file.
 *  A rename puts a NEW file in place, so what the old one carried is carried over by
 *  hand: its permission bits (a script stays executable), and — for a symlink — the
 *  link itself: the file it points to is written, the link stays a link. Owner, ACLs,
 *  extended attributes and hard links are not kept; a rename cannot keep them. */
export function writeFileAtomic(path: string, data: string): void {
  const target = throughLinks(path);
  const mode = modeOf(target);
  const tmp = join(dirname(target), `.${basename(target)}.hatch-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data, 'utf8');
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, target);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
    }
    throw e;
  }
}

/** The file a path finally names, following symlinks — also to a target that does not
 *  exist yet, which the write then creates. */
function throughLinks(path: string): string {
  let at = resolve(path);
  for (let hops = 0; hops < 40; hops++) {
    let link: boolean;
    try {
      link = lstatSync(at).isSymbolicLink();
    } catch {
      return at;
    }
    if (!link) return at;
    at = resolve(dirname(at), readlinkSync(at));
  }
  throw new PathError(`${path}: too many levels of symbolic links`, path, at);
}

function modeOf(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o7777;
  } catch {
    return undefined;
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

/** Whether writing to `target` replaces the file `file` is: the same file by identity
 *  (device + inode), not by spelling — `Foo.c` and `foo.c` are one file on a
 *  case-insensitive disk. Followed through symlinks, as `writeFileAtomic` writes through
 *  them. A hard link counts as the same file, which only ever errs towards asking. */
export function replacesFile(target: string, file: string): boolean {
  try {
    const t = statSync(target, { bigint: true });
    const f = statSync(file, { bigint: true });
    return t.dev === f.dev && t.ino === f.ino;
  } catch {
    return false;
  }
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
