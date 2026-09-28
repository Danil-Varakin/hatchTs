import { dirname, resolve } from 'node:path';
import type { Tracer, SynthEvent } from '../generate/synth.ts';
import { generatePatch } from '../generate/pipeline.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { describeHunk } from '../generate/agreement.ts';
import type { GenerateOutcome, GenerateRequest } from '../generate/pipeline.ts';
import type { Steering } from '../generate/steer.ts';
import { AmbiguityError, MatchError } from '../core/errors.ts';
import { editorCommand, editSession } from './editor.ts';
import type { EditSession } from './editor.ts';
import { InputClosed } from '../infra/ask.ts';
import type { Ask } from '../infra/ask.ts';
import { ensureParent, readInputFile, writeFileAtomic } from '../infra/fs.ts';
import { resolveOutPath } from '../infra/out-path.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';
import { CONFIG_FILE_NAME, formatConfig, loadConfig, overridesFrom } from '../infra/config/index.ts';
import type { FlagOverride, PartialSettings, ResolvedConfig } from '../infra/config/index.ts';
import type { ErrorContext, Logger } from '../infra/log.ts';
import { invokedDirectly } from '../infra/entry.ts';
import type { ArgSpec } from './args.ts';
import { runCommand } from './command.ts';
import { GIT_ARGS, GIT_FLAG_NAMES, GIT_USAGE, asksGit, readFromGit } from './git-source.ts';
import type { FileVersion, GitOptions } from './git-source.ts';
import { CONFIRM_ARGS, CONFIRM_USAGE, terminalAsker } from './confirm.ts';
import type { ConfirmOptions } from './confirm.ts';
import { answersFrom } from './prompt.ts';
import { namedLanguage } from '../lang/adapter.ts';
import type { Answers } from './prompt.ts';

interface Options extends GitOptions, ConfirmOptions {
  in?: string;
  inOld?: string;
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
  mirror: boolean;
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

The OLD version — exactly one source, either a file on disk or git.

  --in-old     <file>     old version, read from this path

${GIT_USAGE}

${CONFIRM_USAGE}

  --out,    -o <path>     where to write the .md. A directory (existing, or ending
                          with a slash) gets <name of --in>.md inside it; any other
                          path is written as is and overwritten. Missing directories
                          are created. A relative path is measured from the
                          repository root, not from the current directory. Omitted
                          means next to --in; \`-\` writes to stdout
  --mirror                keep the patches in a tree of their own: the .md goes to
                          <--out>/<path of --in inside the repository>.md, and
                          missing directories are created. Requires --out to name a
                          directory; a relative one is taken from the repository
                          root, never from the current directory. Paths are measured
                          from the nearest ancestor holding .git, so a file outside
                          any repository is an error rather than a guess
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
                          synthesis trace, whether or not -v is on. A place that is a
                          directory (or ends in /) receives a generated name, so every
                          run gets its own file; any other place IS the name and is
                          overwritten. Omitted → ./hatch-logs/. A log that cannot be
                          opened is a warning, not a failure: the run goes on without it
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
                          ${CONFIG_FILE_NAME} upwards from --in. The search stops
                          at the repository root and never enters the home
                          directory; --config itself has no such bound
  --no-config             ignore config files entirely (built-in defaults + flags)
  --print-config          print the effective settings with the origin of each
                          (default / config / flag) and exit`;

const SPEC: ArgSpec<Options> = {
  flags: {
    ...GIT_ARGS.flags,
    ...CONFIRM_ARGS.flags,
    '--agreement': 'agreement', '-a': 'agreement',
    '--exact': 'exact', '-e': 'exact',
    '--debug': 'debug', '-v': 'debug',
    '--help': 'help', '-h': 'help',
    '--require-parents': 'requireParents',
    '--mirror': 'mirror',
    '--download-grammars': 'downloadGrammars',
    '--print-config': 'printConfig',
  },
  negated: { '--no-config': 'useConfig' },
  values: {
    ...GIT_ARGS.values,
    '--in': 'in', '-i': 'in',
    '--in-old': 'inOld',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
    '--config': 'config',
  },
  counts: {
    '--parents': 'parents',
    '--min-parents': 'minParents',
    '--parent-detail': 'parentDetailBase',
    '--min-siblings': 'minSiblings',
    '--siblings': 'siblings',
    '--sibling-detail': 'siblingDetailBase',
    '--bridge-gap': 'bridgeGap',
  },
  optional: { '--log': 'log' },
};

const INITIAL: Options = {
  head: false,
  yes: false,
  requireParents: false,
  mirror: false,
  downloadGrammars: false,
  useConfig: true,
  printConfig: false,
  agreement: false,
  exact: false,
  debug: false,
  help: false,
};

function flagOverrides(opts: Options): FlagOverride[] {
  const values: PartialSettings = {
    out: opts.out,
    mirror: opts.mirror ? true : undefined,
    language: namedLanguage(opts.language),
    exact: opts.exact ? true : undefined,
    bridgeGap: opts.bridgeGap as PartialSettings['bridgeGap'],
    minParents: opts.minParents as PartialSettings['minParents'],
    maxParents: opts.parents as PartialSettings['maxParents'],
    parentDetailBase: opts.parentDetailBase as PartialSettings['parentDetailBase'],
    parentsRequired: opts.requireParents ? true : undefined,
    minSiblings: opts.minSiblings as PartialSettings['minSiblings'],
    maxSiblings: opts.siblings as PartialSettings['maxSiblings'],
    siblingDetailBase: opts.siblingDetailBase as PartialSettings['siblingDetailBase'],
  };
  return overridesFrom(values, (spec) => spec.flag);
}

/** `-a`: each hunk is shown as it is made, and kept unless the answer is no — Enter
 *  keeps it. The answers may come from a terminal or be piped in, one line per hunk; an
 *  input that closes before every hunk is answered stops the run. No offers to write the
 *  hunks by hand; refused, the run stops without a .md. */
function hunkReviewer(answers: Answers): Steering['review'] {
  return async (hunk, number, total) => {
    const answer = await answers.next(`\n${describeHunk(hunk, number - 1, total)}\nkeep this hunk? [Y/n] `);
    if (answer === null) throw new InputClosed();
    return /^\s*n/i.test(answer) ? 'decline' : 'keep';
  };
}

/** A person at a terminal: both ends, as for every question hatch asks. */
function atTerminal(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

/** How a run with a person in it goes on when a hunk has to be written by hand: the
 *  reason is shown, the person asked, and the .md so far opened in their editor. */
function steering(answers: Answers, log: Logger, session: EditSession, review?: Steering['review']): Steering {
  return {
    review,
    async offerEdit(why) {
      log.note(why);
      if (!atTerminal()) {
        log.note('  writing hunks by hand needs a terminal: stopping, nothing is written');
        return false;
      }
      const answer = await answers.next(`  edit the hunks by hand (${editorCommand()})? [y/N] `);
      return answer !== null && /^\s*y(es)?\s*$/i.test(answer);
    },
    edit: (text) => session.edit(text),
  };
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

/** A usage question, answered before a single file is opened: a wrong invocation has
 *  to be told apart from a file that is not there. */
function requireOneOldSource(opts: Options): void {
  const one = `exactly one source of the OLD version: --in-old <file>, or git (${GIT_FLAG_NAMES})`;
  if (opts.inOld !== undefined && asksGit(opts)) throw new Error(`provide ${one} — not both`);
  if (opts.inOld === undefined && !asksGit(opts)) throw new Error(`provide ${one}`);
}

async function oldVersion(opts: Options, inPath: string, ask: Ask): Promise<FileVersion> {
  return opts.inOld !== undefined
    ? { text: readInputFile(opts.inOld, '--in-old'), spec: opts.inOld }
    : readFromGit(opts, inPath, ask);
}

async function run(opts: Options, log: Logger, seen: Seen): Promise<void> {
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
  const answers = answersFrom();
  try {
    await generate(opts, config, log, seen, answers);
  } finally {
    answers.close();
  }
}

async function generate(
  opts: Options,
  config: ResolvedConfig,
  log: Logger,
  seen: Seen,
  answers: Answers,
): Promise<void> {
  if (opts.in === undefined) throw new Error('missing --in <file> (new version)');
  requireOneOldSource(opts);

  const newStr = readInputFile(opts.in, '--in');
  const old = await oldVersion(opts, opts.in, terminalAsker(opts.yes, (m) => log.note(m), answers));
  seen.old = old;
  log.trace(`old version: ${old.spec} (${old.text.length} bytes)`);

  const settings = config.generate;
  const request: GenerateRequest = {
    oldText: old.text,
    newText: newStr,
    language: settings.language ?? undefined,
    path: opts.in,
    exact: settings.exact,
    bridgeGap: settings.bridgeGap,
    limits: settings,
    init: { allowDownload: opts.downloadGrammars || downloadAllowedByEnv() },
    trace: opts.debug || log.logPath !== undefined ? makeTracer(log) : undefined,
  };
  const session = editSession();
  let outcome: GenerateOutcome;
  try {
    outcome = await synthesizeFor(opts, request, () => steering(answers, log, session, hunkReviewer(answers)), () =>
      steering(answers, log, session),
    );
  } catch (e) {
    if (session.file !== undefined) log.note(`the hunks as last edited are kept in ${session.file}`);
    throw e;
  }
  session.discard();

  for (const w of outcome.warnings) log.note(`warning: ${w}`);

  const out = resolveOutPath({ inPath: resolve(opts.in), out: settings.out, mirror: settings.mirror });
  const outPath = out.path;
  if (outPath === undefined) {
    process.stdout.write(outcome.md);
    return;
  }
  ensureParent(outPath);
  writeFileAtomic(outPath, outcome.md);
  log.note(`generated ${outcome.hunkCount} hunk(s) → ${outPath}`);
}

/** `-a` steers from the first hunk. Without it synthesis runs on its own, and only a
 *  change it cannot anchor, with a person at a terminal, hands the run over — a script
 *  or CI gets the error as before. */
async function synthesizeFor(
  opts: Options,
  request: GenerateRequest,
  reviewed: () => Steering,
  unreviewed: () => Steering,
): Promise<GenerateOutcome> {
  if (opts.agreement) return generatePatch({ ...request, steering: reviewed() });
  try {
    return await generatePatch(request);
  } catch (e) {
    if (!(e instanceof MatchError || e instanceof AmbiguityError) || !atTerminal()) throw e;
    return generatePatch({ ...request, steering: unreviewed() });
  }
}

interface Seen {
  old?: FileVersion;
}

export function main(argv: readonly string[]): Promise<void> {
  return runCommand(
    { name: 'generate', usage: USAGE, spec: SPEC, initial: INITIAL, verbose: (o) => o.debug, run, errorContext },
    argv,
  );
}

function errorContext(opts: Options, seen: Seen): ErrorContext {
  if (seen.old !== undefined) return { source: seen.old.text, sourcePath: seen.old.spec };
  return opts.inOld !== undefined ? { sourcePath: opts.inOld } : {};
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
