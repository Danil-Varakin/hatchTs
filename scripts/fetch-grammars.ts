// Fills grammars/ of the package with the grammars src/lang/*/index.ts pins — for
// development, CI and `npm pack` only: hatch itself never downloads anything
// (src/infra/grammar-store.ts). Every file is checked against its sha256 pin; a file
// already there with the right bytes is left alone.
//
//   node --experimental-strip-types scripts/fetch-grammars.ts
//   node --experimental-strip-types scripts/fetch-grammars.ts --pin tree-sitter-go@0.25.0
//       download one grammar and print the block to paste into a new language's index.ts
//
// Where the bytes come from, in order: grammars/ itself; the user cache hatch 0.1–0.3
// filled (a machine that ran it has them, and they are checked like any other); the npm
// CDNs, jsdelivr then unpkg.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { adaptersByName } from '../src/lang/adapter.ts';
import { digest, packageGrammarDir } from '../src/infra/grammar-store.ts';
import type { GrammarSource } from '../src/lang/source-map.ts';

const TIMEOUT_MS = 60_000;

function urls(source: GrammarSource): string[] {
  const spec = `${source.package!}@${source.version!}/${source.file}`;
  return [`https://cdn.jsdelivr.net/npm/${spec}`, `https://unpkg.com/${spec}`];
}

/** Where hatch 0.1–0.3 kept its downloads — read, never written. */
function legacyCacheEntry(source: GrammarSource): string {
  const xdg = process.env['XDG_CACHE_HOME'];
  const root =
    xdg !== undefined && xdg !== ''
      ? join(xdg, 'hatch', 'grammars')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'hatch', 'grammars')
        : process.platform === 'win32'
          ? join(process.env['LOCALAPPDATA'] ?? homedir(), 'hatch', 'grammars')
          : join(homedir(), '.cache', 'hatch', 'grammars');
  return join(root, `${source.package!.replace('/', '+')}@${source.version!}`, source.file);
}

async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchPinned(source: GrammarSource, dir: string): Promise<'present' | 'copied' | 'downloaded'> {
  const target = join(dir, source.file);
  const there = await readIfExists(target);
  if (there !== null && digest(there) === source.sha256) return 'present';

  const cached = await readIfExists(legacyCacheEntry(source));
  let bytes: Uint8Array | undefined = cached !== null && digest(cached) === source.sha256 ? cached : undefined;
  const how = bytes !== undefined ? 'copied' : 'downloaded';
  const failures: string[] = [];
  for (const url of bytes === undefined ? urls(source) : []) {
    try {
      const got = await download(url);
      if (digest(got) !== source.sha256) {
        throw new Error(`checksum mismatch: expected ${source.sha256}, received ${digest(got)}`);
      }
      bytes = got;
      break;
    } catch (e) {
      failures.push(`${url}: ${(e as Error).message}`);
    }
  }
  if (bytes === undefined) throw new Error(`could not get ${source.file}\n  ${failures.join('\n  ')}`);

  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, target);
  return how;
}

async function pin(spec: string): Promise<void> {
  const at = spec.lastIndexOf('@');
  if (at <= 0) throw new Error(`cannot read "${spec}" as <package>@<version>`);
  const pkg = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const file = `${pkg.split('/').pop()}.wasm`;
  const bytes = await download(urls({ file, package: pkg, version })[0]!);
  process.stdout.write(
    [
      '  grammar: {',
      `    file: '${file}',`,
      `    package: '${pkg}',`,
      `    version: '${version}',`,
      `    sha256: '${digest(bytes)}',`,
      '  },',
    ].join('\n') + '\n',
  );
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === '--pin') {
    if (argv[1] === undefined) throw new Error('--pin <package>@<version>');
    await pin(argv[1]);
    return;
  }
  const dir = packageGrammarDir();
  await mkdir(dir, { recursive: true });
  const seen = new Set<string>();
  const counts = { present: 0, copied: 0, downloaded: 0 };
  for (const adapter of adaptersByName().values()) {
    if (seen.has(adapter.grammar.file)) continue;
    seen.add(adapter.grammar.file);
    counts[await fetchPinned(adapter.grammar, dir)]++;
  }
  process.stderr.write(
    `grammars/: ${seen.size} grammar(s) — ${counts.present} present, ${counts.copied} copied, ${counts.downloaded} downloaded\n`,
  );
}

main(process.argv.slice(2)).catch((e: unknown) => {
  process.stderr.write(`fetch-grammars: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
