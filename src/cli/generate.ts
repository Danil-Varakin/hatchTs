import { readFileSync, statSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { synthesize } from '../generate/synth.ts';
import type { Tracer, SynthEvent } from '../generate/synth.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { printHatchFile, trailingSpaceWarnings } from '../generate/printer.ts';
import { reviewHunks } from '../generate/agreement.ts';
import type { Confirm } from '../generate/agreement.ts';
import { fileFromBranch } from '../infra/git.ts';
import { writeFileAtomic } from '../infra/fs.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';
import { adapterForLanguage, adapterForFile } from '../lang/adapter.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';
import { CONFIG_FILE_NAME, formatConfig, loadConfig } from '../infra/config/index.ts';
import type { FlagOverride, ResolvedConfig } from '../infra/config/index.ts';
import { HatchError } from '../core/errors.ts';

interface Options {
  in?: string;
  inOld?: string;
  branch?: string;
  out?: string;
  language?: string;
  config?: string;
  parents?: unknown;
  minParents?: unknown;
  parentDetailBase?: unknown;
  parentDetailLimit?: unknown;
  siblings?: unknown;
  minSiblings?: unknown;
  siblingDetailBase?: unknown;
  siblingDetailLimit?: unknown;
  bridgeGap?: unknown;
  requireParents: boolean;
  downloadGrammars: boolean;
  useConfig: boolean;
  printConfig: boolean;
  agreement: boolean;
  exact: boolean;
  debug: boolean;
  help: boolean;
}

const USAGE = `hatch generate — synthesize .md instructions from two versions of a file

  --in,     -i <file>     new version of the file                    [required]
  --in-old     <file>     old version (from a file)      [one of --in-old/--branch]
  --branch, -b <branch>   old version = <branch>:<--in path> (git)
  --out,    -o <path>     where to write the .md. A file path is taken as is; a
                          directory (existing, or ending with a slash) gets
                          <name of --in>.md inside it; omitted means next to
                          --in. \`-\` writes to stdout
  --language,-l <lang>    force language (else: extension of --in)
  --agreement,-a          confirm each hunk before writing
  --exact,  -e            reproduce the new file byte for byte; without it every
                          line only has to match after normalization (indentation
                          and inner spacing are free, the set of lines is not)
  --debug,  -v            trace synthesis to stderr: every segment, each probe
                          attempt (incl. non-unique) and the chosen hunk
  --download-grammars     allow fetching the language's grammar if it is missing
                          (off by default; npm run grammars fetches them once)
  --help,   -h            this help

Anchoring (how much context a generated hunk carries). Every one of these can also
be set in ${CONFIG_FILE_NAME}; the flag wins for this run.

  --parents <n|all>       cap on climbing up: at most n enclosing blocks per
                          pattern (default: all)
  --min-parents <n>       enclosing blocks EVERY pattern carries (default: 1).
                          A hunk with no parent is not structural — drifting
                          neighbours can land it in another function
  --parent-detail <n>     bracket levels spelled out in parent headers, counting
                          from the outermost: 0 gives \`foo( ... )\`, 1 gives
                          \`foo(bar( ... ))\` (default: 0)
  --parent-detail-limit <n>
                          how far the ladder may unfold parent headers when an
                          anchor turns out ambiguous; unfolding goes OUTSIDE IN,
                          one bracket layer per rung (default: 2)
  --min-siblings <n>      neighbouring significant lines EVERY pattern carries,
                          per side (default: 1)
  --siblings <n>          cap of neighbouring significant lines per side
                          (default: 3). 0 forbids leaning on neighbours at all —
                          anchoring stays purely structural
  --sibling-detail <n>    same bracket baseline for neighbour anchors (default: 0)
  --sibling-detail-limit <n>
                          same unfolding ceiling for neighbour anchors (default: 2)
  --require-parents       never fall back to a parentless pattern: fail instead of
                          emitting an anchor that drift can move
  --bridge-gap <n>        stitch edits split by up to n unchanged non-blank lines
                          back into one hunk (default: 0)

Configuration

  --config <file>         use this config file instead of searching for
                          ${CONFIG_FILE_NAME} upwards from --in
  --no-config             ignore config files entirely (built-in defaults + flags)
  --print-config          print the effective settings with the origin of each
                          (default / config / flag) and exit`;

type StringOption = 'in' | 'inOld' | 'branch' | 'out' | 'language' | 'config';
type CountOption =
  | 'parents'
  | 'minParents'
  | 'parentDetailBase'
  | 'parentDetailLimit'
  | 'minSiblings'
  | 'siblings'
  | 'siblingDetailBase'
  | 'siblingDetailLimit'
  | 'bridgeGap';

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    requireParents: false,
    downloadGrammars: false,
    useConfig: true,
    printConfig: false,
    agreement: false,
    exact: false,
    debug: false,
    help: false,
  };
  const takesValue: Record<string, StringOption> = {
    '--in': 'in', '-i': 'in',
    '--in-old': 'inOld',
    '--branch': 'branch', '-b': 'branch',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
    '--config': 'config',
  };
  const takesCount: Record<string, CountOption> = {
    '--parents': 'parents',
    '--min-parents': 'minParents',
    '--parent-detail': 'parentDetailBase',
    '--parent-detail-limit': 'parentDetailLimit',
    '--min-siblings': 'minSiblings',
    '--siblings': 'siblings',
    '--sibling-detail': 'siblingDetailBase',
    '--sibling-detail-limit': 'siblingDetailLimit',
    '--bridge-gap': 'bridgeGap',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--agreement' || a === '-a') opts.agreement = true;
    else if (a === '--exact' || a === '-e') opts.exact = true;
    else if (a === '--debug' || a === '-v') opts.debug = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--require-parents') opts.requireParents = true;
    else if (a === '--download-grammars') opts.downloadGrammars = true;
    else if (a === '--no-config') opts.useConfig = false;
    else if (a === '--print-config') opts.printConfig = true;
    else {
      const countKey = takesCount[a];
      if (countKey !== undefined) {
        const val = argv[++i];
        if (val === undefined) throw new Error(`option ${a} needs a value`);
        opts[countKey] = parseCountValue(val);
        continue;
      }
      const key = takesValue[a];
      if (key === undefined) throw new Error(`unknown argument: ${a}`);
      const val = argv[++i];
      if (val === undefined) throw new Error(`option ${a} needs a value`);
      opts[key] = val;
    }
  }
  return opts;
}

function parseCountValue(raw: string): unknown {
  if (raw === 'all') return 'all';
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function flagOverrides(opts: Options): FlagOverride[] {
  const out: FlagOverride[] = [];
  const push = (key: FlagOverride['key'], value: unknown, flag: string): void => {
    if (value !== undefined) out.push({ key, value, flag });
  };
  push('out', opts.out, '--out');
  push('language', opts.language, '--language');
  push('exact', opts.exact ? true : undefined, '--exact');
  push('bridgeGap', opts.bridgeGap, '--bridge-gap');
  push('minParents', opts.minParents, '--min-parents');
  push('maxParents', opts.parents, '--parents');
  push('parentDetailBase', opts.parentDetailBase, '--parent-detail');
  push('parentDetailLimit', opts.parentDetailLimit, '--parent-detail-limit');
  push('parentsRequired', opts.requireParents ? true : undefined, '--require-parents');
  push('minSiblings', opts.minSiblings, '--min-siblings');
  push('maxSiblings', opts.siblings, '--siblings');
  push('siblingDetailBase', opts.siblingDetailBase, '--sibling-detail');
  push('siblingDetailLimit', opts.siblingDetailLimit, '--sibling-detail-limit');
  return out;
}

function langLabel(language: string | null, inPath: string): string | undefined {
  if (language !== null) return language;
  const dot = inPath.lastIndexOf('.');
  return dot === -1 ? undefined : inPath.slice(dot + 1);
}

export function resolveOutPath(out: string | undefined, inPath: string): string | undefined {
  const defaultName = `${basename(inPath)}.md`;
  if (out === undefined) return join(dirname(inPath), defaultName);
  if (out === '-') return undefined;
  if (/[/\\]$/.test(out) || isDirectory(out)) return join(out, defaultName);
  return out;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false; // no such path: treat it as a file name
  }
}

function resolveAdapter(language: string | null, inPath: string): LanguageAdapter {
  return language !== null ? adapterForLanguage(language) : adapterForFile(inPath);
}

function makeStdinConfirm(): { confirm: Confirm; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const confirm: Confirm = (question) =>
    new Promise((res) => {
      process.stderr.write(`\n${question}\n`);
      rl.question('keep this hunk? [Y/n] ', (a) => res(!/^\s*n/i.test(a)));
    });
  return { confirm, close: () => rl.close() };
}

function makeTracer(): Tracer {
  const indent = (s: string): string => s.replace(/^/gm, '        ');
  const kindOf = (e: Extract<SynthEvent, { kind: 'segment' }>): string =>
    e.seg.removed.length > 0 && e.seg.added.length > 0 ? 'replace' : e.seg.added.length > 0 ? 'insert' : 'delete';
  return (e) => {
    if (e.kind === 'segment') {
      process.stderr.write(`\n── segment #${e.index + 1} (${kindOf(e)}) @ old line ${e.seg.oldStart}\n`);
      for (const l of e.seg.removed) process.stderr.write(`   - ${l}\n`);
      for (const l of e.seg.added) process.stderr.write(`   + ${l}\n`);
    } else if (e.kind === 'attempt') {
      const tag =
        e.result === 'unique'
          ? '✓ unique'
          : e.result === 'ambiguous'
            ? `✗ ambiguous (${e.matches}+ matches — need more context)`
            : '∅ no match';
      process.stderr.write(`   try → ${tag}\n${indent(printPattern(e.pattern))}\n`);
    } else {
      process.stderr.write(`   ➜ CHOSEN, patch: ${JSON.stringify(e.patch)}\n`);
    }
  };
}

async function run(opts: Options, config: ResolvedConfig): Promise<void> {
  if (opts.in === undefined) throw new Error('missing --in <file> (new version)');
  if ((opts.inOld === undefined) === (opts.branch === undefined)) {
    throw new Error('provide exactly one source of the OLD version: --in-old <file> OR --branch <branch>');
  }

  const newStr = readFileSync(opts.in, 'utf8');
  const oldStr =
    opts.inOld !== undefined ? readFileSync(opts.inOld, 'utf8') : await fileFromBranch(opts.branch!, opts.in);

  const settings = config.generate;
  const adapter = resolveAdapter(settings.language, opts.in);
  await adapter.init({ allowDownload: opts.downloadGrammars || downloadAllowedByEnv() });

  let hunks = synthesize(oldStr, newStr, adapter, {
    exact: settings.exact,
    bridgeGap: settings.bridgeGap,
    trace: opts.debug ? makeTracer() : undefined,
    limits: settings,
  });

  if (opts.agreement) {
    const { confirm, close } = makeStdinConfirm();
    try {
      hunks = await reviewHunks(hunks, confirm);
    } finally {
      close();
    }
  }

  for (const w of trailingSpaceWarnings(hunks)) console.error(`warning: ${w}`);

  const md = printHatchFile(hunks, langLabel(settings.language, opts.in));
  const outPath = resolveOutPath(settings.out ?? undefined, opts.in);
  if (outPath === undefined) {
    process.stdout.write(md);
    return;
  }
  const outDir = dirname(outPath);
  if (!isDirectory(outDir)) throw new Error(`no such directory: ${outDir} (--out ${outPath})`);
  writeFileAtomic(outPath, md);
  console.error(`generated ${hunks.length} hunk(s) → ${outPath}`);
}

export async function main(argv: readonly string[]): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  try {
    const config = loadConfig({
      explicitPath: opts.config,
      startDir: opts.in !== undefined ? dirname(resolve(opts.in)) : process.cwd(),
      useFile: opts.useConfig,
      flags: flagOverrides(opts),
    });
    if (opts.printConfig) {
      process.stdout.write(formatConfig(config));
      return;
    }
    await run(opts, config);
  } catch (e) {
    if (e instanceof HatchError) {
      console.error(`${e.name}: ${e.message}`);
      process.exitCode = e.exitCode;
    } else {
      console.error(`error: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
