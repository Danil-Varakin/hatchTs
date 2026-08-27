import { readFileSync, statSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import type { Tracer, SynthEvent } from '../generate/synth.ts';
import { generatePatch } from '../generate/pipeline.ts';
import type { GenerateOutcome } from '../generate/pipeline.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { reviewHunks } from '../generate/agreement.ts';
import type { Confirm } from '../generate/agreement.ts';
import { fileFromBranch } from '../infra/git.ts';
import { writeFileAtomic } from '../infra/fs.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';
import { CONFIG_FILE_NAME, formatConfig, loadConfig } from '../infra/config/index.ts';
import type { FlagOverride, ResolvedConfig } from '../infra/config/index.ts';
import { HatchError } from '../core/errors.ts';
import { createLogger, resolveLogPath, logHeader } from '../infra/log.ts';
import type { Logger } from '../infra/log.ts';

interface Options {
  in?: string;
  inOld?: string;
  branch?: string;
  out?: string;
  language?: string;
  config?: string;
  log?: string;
  parents?: unknown;
  minParents?: unknown;
  parentDetailBase?: unknown;
  siblings?: unknown;
  minSiblings?: unknown;
  siblingDetailBase?: unknown;
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
  --log [place]           also write a full log — the resolved config and the whole
                          synthesis trace, whether or not -v is on. Every run gets its
                          own file. A place that is a directory (or ends in /) receives
                          a generated name, otherwise it IS the name; omitted →
                          ./hatch-logs/
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
                          \`foo(bar( ... ))\` (default: 0). This is the READABLE
                          baseline; when an anchor turns out ambiguous the ladder
                          unfolds further on its own, one NAMED bracket at a time,
                          and stops as soon as no bracket tells the places apart
  --min-siblings <n>      neighbouring significant lines EVERY pattern carries,
                          per side (default: 0)
  --siblings <n>          cap of neighbouring significant lines per side
                          (default: 8). 0 forbids leaning on neighbours at all —
                          anchoring stays purely structural
  --sibling-detail <n>    same bracket baseline for neighbour anchors (default: 0)
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
  | 'minSiblings'
  | 'siblings'
  | 'siblingDetailBase'
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
    '--min-siblings': 'minSiblings',
    '--siblings': 'siblings',
    '--sibling-detail': 'siblingDetailBase',
    '--bridge-gap': 'bridgeGap',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--log') {
      const next = argv[i + 1];
      opts.log = next !== undefined && !next.startsWith('-') ? argv[++i]! : '';
      continue;
    }
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
  push('parentsRequired', opts.requireParents ? true : undefined, '--require-parents');
  push('minSiblings', opts.minSiblings, '--min-siblings');
  push('maxSiblings', opts.siblings, '--siblings');
  push('siblingDetailBase', opts.siblingDetailBase, '--sibling-detail');
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
    return false;
  }
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

function makeTracer(log: Logger): Tracer {
  const write = (line: string): void => log.trace(line);
  const indent = (s: string): string => s.replace(/^/gm, '        ');
  const kindOf = (e: Extract<SynthEvent, { kind: 'segment' }>): string =>
    e.seg.removed.length > 0 && e.seg.added.length > 0 ? 'replace' : e.seg.added.length > 0 ? 'insert' : 'delete';
  return (e) => {
    if (e.kind === 'segment') {
      write(`\n── segment #${e.index + 1} (${kindOf(e)}) @ old line ${e.seg.oldStart}`);
      for (const l of e.seg.removed) write(`   - ${l}`);
      for (const l of e.seg.added) write(`   + ${l}`);
    } else if (e.kind === 'attempt') {
      const tag =
        e.result === 'unique'
          ? '✓ unique'
          : e.result === 'ambiguous'
            ? `✗ ambiguous (${e.matches}+ matches — need more context)`
            : '∅ no match';
      write(`   try → ${tag}\n${indent(printPattern(e.pattern))}`);
    } else {
      write(`   ➜ CHOSEN, patch: ${JSON.stringify(e.patch)}`);
    }
  };
}

async function run(opts: Options, config: ResolvedConfig, log: Logger): Promise<void> {
  if (opts.in === undefined) throw new Error('missing --in <file> (new version)');
  if ((opts.inOld === undefined) === (opts.branch === undefined)) {
    throw new Error('provide exactly one source of the OLD version: --in-old <file> OR --branch <branch>');
  }

  const newStr = readFileSync(opts.in, 'utf8');
  const oldStr =
    opts.inOld !== undefined ? readFileSync(opts.inOld, 'utf8') : await fileFromBranch(opts.branch!, opts.in);

  const settings = config.generate;
  const review = opts.agreement ? makeStdinConfirm() : null;
  let outcome: GenerateOutcome;
  try {
    outcome = await generatePatch({
      oldText: oldStr,
      newText: newStr,
      language: settings.language ?? undefined,
      path: opts.in,
      label: langLabel(settings.language, opts.in),
      exact: settings.exact,
      bridgeGap: settings.bridgeGap,
      limits: settings,
      init: { allowDownload: opts.downloadGrammars || downloadAllowedByEnv() },
      trace: opts.debug || log.logPath !== undefined ? makeTracer(log) : undefined,
      ...(review !== null ? { review: (hunks) => reviewHunks(hunks, review.confirm) } : {}),
    });
  } finally {
    review?.close();
  }

  for (const w of outcome.warnings) log.note(`warning: ${w}`);

  const outPath = resolveOutPath(settings.out ?? undefined, opts.in);
  if (outPath === undefined) {
    process.stdout.write(outcome.md);
    return;
  }
  const outDir = dirname(outPath);
  if (!isDirectory(outDir)) throw new Error(`no such directory: ${outDir} (--out ${outPath})`);
  writeFileAtomic(outPath, outcome.md);
  log.note(`generated ${outcome.hunkCount} hunk(s) → ${outPath}`);
}

export async function main(argv: readonly string[]): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  let log: Logger;
  try {
    log = createLogger({
      ...(opts.log !== undefined ? { logPath: resolveLogPath(opts.log, 'generate') } : {}),
      verbose: opts.debug,
      header: logHeader('generate', argv),
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = e instanceof HatchError ? e.exitCode : 1;
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
    if (log.logPath !== undefined) log.trace(formatConfig(config).trimEnd());
    await run(opts, config, log);
    if (log.logPath !== undefined) log.note(`log: ${log.logPath}`);
  } catch (e) {
    process.exitCode = log.fail(e, errorContext(opts));
  } finally {
    log.close();
  }
}

function errorContext(opts: Options): { source?: string; sourcePath?: string } {
  if (opts.inOld === undefined) return {};
  try {
    return { source: readFileSync(opts.inOld, 'utf8'), sourcePath: opts.inOld };
  } catch {
    return { sourcePath: opts.inOld };
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
