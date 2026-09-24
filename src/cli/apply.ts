import { parseHatchFile } from '../core/hatch-parser.ts';
import { applyAll } from '../core/apply.ts';
import type { AppliedEdit } from '../core/apply.ts';
import { ensureParent, readInputFile, writeFileAtomic } from '../infra/fs.ts';
import { resolveOutPath } from '../infra/out-path.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';
import { adapterForLanguage, adapterForFile } from '../lang/adapter.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';
import { createLoggerOrWarn, resolveLogPath, logHeader } from '../infra/log.ts';
import type { Logger } from '../infra/log.ts';
import { invokedDirectly } from '../infra/entry.ts';
import { parseArgs } from './args.ts';
import type { ArgSpec } from './args.ts';

interface Options {
  match?: string;
  in?: string;
  out?: string;
  log?: string;
  language?: string;
  dryRun: boolean;
  verify: boolean;
  downloadGrammars: boolean;
  help: boolean;
}

const USAGE = `hatch apply — apply .md instructions to a source file

  --match, -m <file.md>   patch instructions (match/patch hunks)   [required]
  --in,    -i <file>      source file to patch                     [required]
  --out,   -o <path>      where to write the result   [required unless --dry-run/--verify]
                          a directory (existing, or ending with a slash) gets
                          <name of --in> inside it; any other path is written as is
                          and overwritten. Missing directories are created, and a
                          relative path is measured from the repository root.
                          \`-\` writes to stdout
  --language, -l <lang>   force language (else: '# match <lang>' in the .md, else
                          the file extension)
  --dry-run               show planned edits, write nothing
  --verify                exit code only (0 = applies cleanly), write nothing
  --download-grammars     allow fetching the language's grammar if it is missing
                          (off by default; npm run grammars fetches them once)
  --log [place]           also write a full log. A place that is a directory (or ends
                          in /) receives a generated name, so every run gets its own
                          file; any other place IS the name and is overwritten.
                          Omitted → ./hatch-logs/. A log that cannot be opened is a
                          warning, not a failure: the run goes on without it
  --help,  -h             this help`;

const SPEC: ArgSpec<Options> = {
  flags: {
    '--dry-run': 'dryRun',
    '--verify': 'verify',
    '--download-grammars': 'downloadGrammars',
    '--help': 'help',
    '-h': 'help',
  },
  values: {
    '--match': 'match', '-m': 'match',
    '--in': 'in', '-i': 'in',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
  },
  optional: { '--log': 'log' },
};

function resolveAdapter(opts: Options, mdLanguage: string | undefined): LanguageAdapter {
  if (opts.language !== undefined) return adapterForLanguage(opts.language);
  if (mdLanguage !== undefined) return adapterForLanguage(mdLanguage);
  return adapterForFile(opts.in!);
}

function describeEdit(applied: AppliedEdit, index: number, total: number): string {
  const { edit, oldText } = applied;
  const kind = edit.start === edit.end ? 'INSERT' : 'REPLACE';
  const where = edit.start === edit.end ? `@${edit.start}` : `[${edit.start}, ${edit.end})`;
  const old = edit.start === edit.end ? '' : `\n    old: ${JSON.stringify(oldText)}`;
  return `hunk ${index + 1}/${total}:\n  ${kind} ${where}\n    new: ${JSON.stringify(edit.text)}${old}`;
}

async function run(opts: Options, log: Logger): Promise<void> {
  if (opts.match === undefined) throw new Error('missing --match <file.md>');
  if (opts.in === undefined) throw new Error('missing --in <file>');
  const willWrite = !opts.dryRun && !opts.verify;
  if (willWrite && opts.out === undefined) {
    throw new Error('missing --out <file> (or use --dry-run / --verify)');
  }

  const file = parseHatchFile(readInputFile(opts.match, '--match'));
  const adapter = resolveAdapter(opts, file.language);
  await adapter.init({ allowDownload: opts.downloadGrammars || downloadAllowedByEnv() });

  const source = readInputFile(opts.in, '--in');
  log.trace(`source: ${opts.in} (${source.length} bytes), ${file.hunks.length} hunk(s)`);
  const { source: result, edits } = applyAll(source, file, adapter);

  if (opts.dryRun) {
    for (const [i, e] of edits.entries()) log.info(describeEdit(e, i, edits.length));
    log.info(`dry-run: ${edits.length} hunk(s) would apply (nothing written)`);
    return;
  }
  if (opts.verify) {
    log.info(`verify: ok — ${edits.length} hunk(s) apply cleanly`);
    return;
  }
  const target = resolveOutPath({ inPath: opts.in, out: opts.out!, suffix: '' }).path;
  if (target === undefined) {
    process.stdout.write(result);
    log.note(`applied ${edits.length} hunk(s) → stdout`);
    return;
  }
  ensureParent(target);
  writeFileAtomic(target, result);
  log.info(`applied ${edits.length} hunk(s) → ${target}`);
}

export async function main(argv: readonly string[]): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(argv, SPEC, { dryRun: false, verify: false, downloadGrammars: false, help: false });
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const log = createLoggerOrWarn({
    ...(opts.log !== undefined ? { logPath: resolveLogPath(opts.log, 'apply') } : {}),
    header: logHeader('apply', argv),
  });

  try {
    await run(opts, log);
    if (log.logPath !== undefined) log.note(`log: ${log.logPath}`);
  } catch (e) {
    process.exitCode = log.fail(e, errorContext(opts));
  } finally {
    log.close();
  }
}

function errorContext(opts: Options): { source?: string; sourcePath?: string; mdPath?: string } {
  const ctx: { source?: string; sourcePath?: string; mdPath?: string } = {};
  if (opts.in !== undefined) {
    ctx.sourcePath = opts.in;
    try {
      ctx.source = readInputFile(opts.in, '--in');
    } catch {
    }
  }
  if (opts.match !== undefined) ctx.mdPath = opts.match;
  return ctx;
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
