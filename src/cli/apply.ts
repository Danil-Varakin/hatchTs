import { resolve } from 'node:path';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { applyAll } from '../core/apply.ts';
import type { AppliedEdit } from '../core/apply.ts';
import type { HatchFile } from '../core/ast.ts';
import { ensureParent, isFile, readInputFile, replacesFile, writeFileAtomic } from '../infra/fs.ts';
import { resolveOutPath } from '../infra/out-path.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';
import { pickAdapter } from '../lang/adapter.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';
import type { ErrorContext, Logger } from '../infra/log.ts';
import { invokedDirectly } from '../infra/entry.ts';
import type { ArgSpec } from './args.ts';
import { runCommand } from './command.ts';
import { GIT_ARGS, GIT_USAGE, asksGit, readFromGit } from './git-source.ts';
import type { FileVersion, GitOptions } from './git-source.ts';
import { CONFIRM_ARGS, CONFIRM_USAGE, terminalAsker } from './confirm.ts';
import type { ConfirmOptions } from './confirm.ts';
import type { Ask } from '../infra/ask.ts';
import { answersFrom } from './prompt.ts';

interface Options extends GitOptions, ConfirmOptions {
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
  --in,    -i <file>      the file to patch                        [required]
                          read from disk — unless a git coordinate below is named:
                          then only its PATH is used (the repository, the default
                          path inside it, the name of the result), the content comes
                          out of git, and the file need not exist on disk at all

${GIT_USAGE}

${CONFIRM_USAGE}

  --out,   -o <path>      where to write the result   [required unless --dry-run/--verify]
                          a directory (existing, or ending with a slash) gets
                          <name of --in> inside it; any other path is written as is
                          and overwritten. Missing directories are created, and a
                          relative path is measured from the repository root.
                          \`-\` writes to stdout. Writing over --in itself while its
                          content came out of git ASKS first when that would lose what
                          --in holds now (see --yes) — and does not ask when --in had
                          the git text anyway, or the result is --in itself
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
    ...GIT_ARGS.flags,
    ...CONFIRM_ARGS.flags,
    '--dry-run': 'dryRun',
    '--verify': 'verify',
    '--download-grammars': 'downloadGrammars',
    '--help': 'help',
    '-h': 'help',
  },
  values: {
    ...GIT_ARGS.values,
    '--match': 'match', '-m': 'match',
    '--in': 'in', '-i': 'in',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
  },
  optional: { '--log': 'log' },
};

const INITIAL: Options = {
  head: false,
  yes: false,
  dryRun: false,
  verify: false,
  downloadGrammars: false,
  help: false,
};

function describeEdit(applied: AppliedEdit, index: number, total: number): string {
  const { edit, oldText } = applied;
  const kind = edit.start === edit.end ? 'INSERT' : 'REPLACE';
  const where = edit.start === edit.end ? `@${edit.start}` : `[${edit.start}, ${edit.end})`;
  const old = edit.start === edit.end ? '' : `\n    old: ${JSON.stringify(oldText)}`;
  return `hunk ${index + 1}/${total}:\n  ${kind} ${where}\n    new: ${JSON.stringify(edit.text)}${old}`;
}

/** The file to patch: the one on disk, or — once any coordinate is named — its version
 *  out of git, with `--in` reduced to naming WHICH file that is. */
async function sourceOf(opts: Options, inPath: string, ask: Ask): Promise<FileVersion> {
  return asksGit(opts) ? readFromGit(opts, inPath, ask) : { text: readInputFile(inPath, '--in'), spec: inPath };
}

/** Writing the result over --in while its content came out of git puts the patched git
 *  version where the working file is. Nothing is lost when the working file held the git
 *  text to begin with, or when the result IS the working file (a patch generated from
 *  that very version, applied back) — then there is nothing to ask. Anything else throws
 *  away what the file holds now, and that is asked first. */
async function mustKeepLocalEdits(
  target: string,
  inPath: string,
  source: FileVersion,
  result: string,
  ask: Ask,
): Promise<void> {
  const file = resolve(inPath);
  if (!isFile(file) || !replacesFile(target, file)) return;
  const onDisk = readInputFile(file, '--in');
  if (onDisk === source.text || onDisk === result) return;
  const question =
    `writing over ${inPath}: it holds changes that ${source.spec} does not, and the patched ` +
    `${source.spec} takes its place — whatever of its current content is not committed is lost`;
  if (await ask(question)) return;
  throw new Error(
    `--out is --in itself, and ${inPath} holds changes that ${source.spec} does not: writing ` +
      `the patched ${source.spec} over it would lose them\n` +
      '  write the result elsewhere, or drop the git flags to patch the file as it is on disk',
  );
}

async function run(opts: Options, log: Logger, seen: Seen): Promise<void> {
  if (opts.match === undefined) throw new Error('missing --match <file.md>');
  if (opts.in === undefined) throw new Error('missing --in <file>');
  const willWrite = !opts.dryRun && !opts.verify;
  if (willWrite && opts.out === undefined) {
    throw new Error('missing --out <file> (or use --dry-run / --verify)');
  }

  const file = parseHatchFile(readInputFile(opts.match, '--match'));
  const adapter = pickAdapter({ language: opts.language, heading: file.language, path: opts.in });
  await adapter.init({ allowDownload: opts.downloadGrammars || downloadAllowedByEnv() });

  const answers = answersFrom();
  try {
    await applyWith(opts, opts.in, file, adapter, log, seen, terminalAsker(opts.yes, (m) => log.note(m), answers));
  } finally {
    answers.close();
  }
}

async function applyWith(
  opts: Options,
  inPath: string,
  file: HatchFile,
  adapter: LanguageAdapter,
  log: Logger,
  seen: Seen,
  ask: Ask,
): Promise<void> {
  const source = await sourceOf(opts, inPath, ask);
  seen.source = source;
  log.trace(`source: ${source.spec} (${source.text.length} bytes), ${file.hunks.length} hunk(s)`);
  const { source: result, edits } = applyAll(source.text, file, adapter);

  if (opts.dryRun) {
    for (const [i, e] of edits.entries()) log.info(describeEdit(e, i, edits.length));
    log.info(`dry-run: ${edits.length} hunk(s) would apply (nothing written)`);
    return;
  }
  if (opts.verify) {
    log.info(`verify: ok — ${edits.length} hunk(s) apply cleanly`);
    return;
  }
  const target = resolveOutPath({ inPath, out: opts.out!, suffix: '' }).path;
  if (target === undefined) {
    process.stdout.write(result);
    log.note(`applied ${edits.length} hunk(s) → stdout`);
    return;
  }
  if (asksGit(opts)) await mustKeepLocalEdits(target, inPath, source, result, ask);
  ensureParent(target);
  writeFileAtomic(target, result);
  log.info(`applied ${edits.length} hunk(s) → ${target}`);
}

interface Seen {
  source?: FileVersion;
}

export function main(argv: readonly string[]): Promise<void> {
  return runCommand({ name: 'apply', usage: USAGE, spec: SPEC, initial: INITIAL, run, errorContext }, argv);
}

function errorContext(opts: Options, seen: Seen): ErrorContext {
  const ctx: { source?: string; sourcePath?: string; mdPath?: string } = {};
  if (seen.source !== undefined) {
    ctx.source = seen.source.text;
    ctx.sourcePath = seen.source.spec;
  } else if (opts.in !== undefined) {
    ctx.sourcePath = opts.in;
  }
  if (opts.match !== undefined) ctx.mdPath = opts.match;
  return ctx;
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
