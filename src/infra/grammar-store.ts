import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

import { GrammarError } from '../core/errors.ts';
import type { GrammarSource, InitOptions } from '../lang/source-map.ts';

export type { GrammarSource, InitOptions } from '../lang/source-map.ts';

export type GrammarInput = string | Uint8Array;

const DOWNLOAD_TIMEOUT_MS = 60_000;

// ── public API ───────────────────────────────────────────────────────────────────
export async function resolveGrammar(
  source: GrammarSource,
  policy: InitOptions = {},
  language?: string,
): Promise<GrammarInput> {
  validate(source);

  if (source.path !== undefined) {
    const bytes = await readIfExists(source.path);
    if (bytes === null) throw new GrammarError(`no grammar file at ${source.path}`, describe(source));
    return bytes;
  }

  for (const dir of localDirs()) {
    const candidate = join(dir, source.file);
    const bytes = await readIfExists(candidate);
    if (bytes !== null) return bytes;
  }

  const cached = await readIfExists(cacheEntry(source));
  if (cached !== null) {
    if (digest(cached) === source.sha256) return cached;
    policy.log?.(`cached ${source.file} failed its checksum, refetching`);
  }

  if (policy.allowDownload !== true) throw refusal(source, language);

  const bytes = await download(source, policy);
  await cache(source, bytes, policy);
  return bytes;
}

export function cacheEntry(source: GrammarSource): string {
  return join(grammarCacheDir(), entryDir(source), source.file);
}

export function grammarCacheDir(): string {
  const override = process.env['HATCH_GRAMMAR_CACHE'];
  if (override !== undefined && override !== '') return override;
  const xdg = process.env['XDG_CACHE_HOME'];
  if (xdg !== undefined && xdg !== '') return join(xdg, 'hatch', 'grammars');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'hatch', 'grammars');
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? homedir(), 'hatch', 'grammars');
  }
  return join(homedir(), '.cache', 'hatch', 'grammars');
}

export function downloadAllowedByEnv(): boolean {
  return process.env['HATCH_GRAMMARS_DOWNLOAD'] === '1';
}

export interface GrammarStatus {
  readonly source: GrammarSource;
  readonly where: 'local' | 'cache' | 'downloaded';
  readonly path: string | undefined; 
  readonly bytes: number;
}

export async function ensureGrammars(
  sources: readonly GrammarSource[],
  policy: InitOptions = {},
): Promise<GrammarStatus[]> {
  const out: GrammarStatus[] = [];
  for (const source of sources) {
    const before = await locate(source);
    const input = await resolveGrammar(source, policy);
    const after = before ?? (await locate(source));
    out.push({
      source,
      where: before === null ? 'downloaded' : before === cacheEntry(source) ? 'cache' : 'local',
      path: after ?? undefined,
      bytes: typeof input === 'string' ? 0 : input.byteLength,
    });
  }
  return out;
}

export async function locate(source: GrammarSource): Promise<string | null> {
  if (source.path !== undefined) return source.path;
  for (const dir of localDirs()) {
    if ((await readIfExists(join(dir, source.file))) !== null) return join(dir, source.file);
  }
  return (await readIfExists(cacheEntry(source))) !== null ? cacheEntry(source) : null;
}

export async function pinFor(spec: string, policy: InitOptions = {}): Promise<GrammarSource> {
  const slash = spec.indexOf('/tree-sitter-', spec.indexOf('/') + 1);
  const nameVersion = slash === -1 ? spec : spec.slice(0, slash);
  const at = nameVersion.lastIndexOf('@');
  if (at <= 0) throw new GrammarError(`cannot read "${spec}" as <package>@<version>`);
  const pkg = nameVersion.slice(0, at);
  const version = nameVersion.slice(at + 1);
  const file = slash === -1 ? `${pkg.split('/').pop()}.wasm` : spec.slice(slash + 1);

  const url = grammarUrls({ file, package: pkg, version })[0]!;
  policy.log?.(`fetching ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new GrammarError(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { file, package: pkg, version, sha256: digest(bytes) };
}

export function formatPin(source: GrammarSource): string {
  return [
    '  grammar: {',
    `    file: '${source.file}',`,
    `    package: '${source.package}',`,
    `    version: '${source.version}',`,
    `    sha256: '${source.sha256}',`,
    '  },',
  ].join('\n');
}

export function grammarUrls(source: GrammarSource): string[] {
  if (source.url !== undefined) return [source.url];
  const spec = `${source.package!}@${source.version!}/${source.file}`;
  
  return [`https://cdn.jsdelivr.net/npm/${spec}`, `https://unpkg.com/${spec}`];
}

// ── lookup helpers ───────────────────────────────────────────────────────────────

function localDirs(): string[] {
  const dirs: string[] = [];
  const override = process.env['HATCH_GRAMMAR_DIR'];
  if (override !== undefined && override !== '') dirs.push(override);
  dirs.push(join(import.meta.dirname, '../../grammars'));
  return dirs;
}

function entryDir(source: GrammarSource): string {
  if (source.package !== undefined) {
    return `${source.package.replace('/', '+')}@${source.version!}`;
  }
  return `url-${source.sha256!.slice(0, 16)}`;
}

async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── download ─────────────────────────────────────────────────────────────────────

async function download(source: GrammarSource, policy: InitOptions): Promise<Uint8Array> {
  const log = policy.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const failures: string[] = [];

  for (const url of grammarUrls(source)) {
    if (!url.startsWith('https://')) {
      throw new GrammarError(`refusing a non-https grammar url: ${url}`, describe(source));
    }
    log(`fetching ${source.file} from ${new URL(url).host}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const got = digest(bytes);
  
      if (got !== source.sha256) {
        throw new GrammarError(
          `checksum mismatch for ${source.file}\n  expected ${source.sha256}\n  received ${got}\n  from ${url}`,
          describe(source),
        );
      }
      return bytes;
    } catch (e) {
      if (e instanceof GrammarError) throw e;
      failures.push(`${url}: ${(e as Error).message}`);
    }
  }

  throw new GrammarError(
    `could not download ${source.file}\n  ${failures.join('\n  ')}`,
    describe(source),
  );
}

async function cache(source: GrammarSource, bytes: Uint8Array, policy: InitOptions): Promise<void> {
  const target = cacheEntry(source);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await mkdir(join(grammarCacheDir(), entryDir(source)), { recursive: true });

    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (e) {
    policy.log?.(`could not cache ${source.file} (${(e as Error).message}); continuing from memory`);
  }
}

// ── diagnostics ──────────────────────────────────────────────────────────────────

function validate(source: GrammarSource): void {
  if (typeof source.file !== 'string' || source.file === '') {
    throw new GrammarError('grammar source has no file name');
  }
  if (source.path !== undefined) {
    if (!isAbsolute(source.path)) {
      throw new GrammarError(`grammar path must be absolute: ${source.path}`, describe(source));
    }
    return;
  }
  const named = source.package !== undefined && source.version !== undefined;
  if (!named && source.url === undefined) {
    throw new GrammarError('grammar source needs either package + version, or url, or path', describe(source));
  }
  if (source.sha256 === undefined || !/^[0-9a-f]{64}$/.test(source.sha256)) {
    throw new GrammarError('grammar source needs a hex sha256 pin to be fetched', describe(source));
  }
}

function describe(source: GrammarSource): string {
  if (source.package !== undefined) return `${source.package}@${source.version}`;
  return source.url ?? source.path ?? source.file;
}

function refusal(source: GrammarSource, language?: string): GrammarError {
  const dirs = [...localDirs(), join(grammarCacheDir(), entryDir(source))];
  const what = language !== undefined ? `the ${language} grammar` : `grammar ${source.file}`;
  const only = language !== undefined ? ` --language ${language}` : '';
  const fix = installedAsPackage()
    ? `hatch grammars${only}`
    : `npm run grammars${only === '' ? '' : ` --${only}`}`;
  return new GrammarError(
    `${what} is not installed\n` +
      `  fetch it once:      ${fix}\n` +
      `  or allow this run:  --download-grammars (or HATCH_GRAMMARS_DOWNLOAD=1)\n` +
      `  looked in:\n${dirs.map((d) => `    ${d}`).join('\n')}`,
    describe(source),
  );
}

function installedAsPackage(): boolean {
  return import.meta.dirname.includes(`${sep}node_modules${sep}`);
}
