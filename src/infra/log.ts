// infra/log.ts — the ONE place that turns facts into text a human reads, and the only
// place that knows a terminal from a file.
//
// WHY IT IS NOT IN core/: rendering a failure needs the source file, the .md, and a
// notion of "line 214" — none of which the core has any business knowing. Errors carry
// FACTS (offsets, the anchor text, step indices); this file renders them. That split is
// what lets the same MatchError print one line into a terminal and twelve into a log.
//
// WHY IT IS NOT CONFIGURABLE: `apply` deliberately takes no configuration, because a
// .md must be self-sufficient (HANDOFF-hatch-config.md §2.1) — so a `log` section in
// hatch.config.json would work for `generate` and silently do nothing for `apply`. A
// flag works the same in both, so logging is flag-driven: `--log [place]`.
import { mkdirSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { HatchError, MatchError, AmbiguityError, ParseError, ConfigError } from '../core/errors.ts';

// ── where a log file goes ────────────────────────────────────────────────────────

/** Default directory for log files, relative to where the user ran the command. */
export const DEFAULT_LOG_DIR = 'hatch-logs';

/**
 * Resolve `--log [place]` into a file path. Every run gets its OWN file — no rotation,
 * no truncation, nothing to lose — named so that `ls` sorts it chronologically.
 *
 * `place` follows the same "a place, not necessarily a name" rule as generate's `--out`:
 * a path ending in a separator, or naming an existing directory, receives a generated
 * file name; anything else is taken as the file name itself. Omitted → DEFAULT_LOG_DIR
 * under the current directory, because a log the user cannot find is not a log.
 *
 * The pid is in the name on purpose: two runs in the same second (a script, a CI
 * matrix) must not land on the same file.
 */
export function resolveLogPath(
  place: string | undefined,
  command: string,
  now: Date = new Date(),
  pid: number = process.pid,
): string {
  const name = `${stamp(now)}-${command}-${pid}.log`;
  if (place === undefined || place === '') return resolve(join(DEFAULT_LOG_DIR, name));
  const looksLikeDir = place.endsWith('/') || place.endsWith('\\') || isDirectory(place);
  const full = isAbsolute(place) ? place : resolve(place);
  return looksLikeDir ? join(full, name) : full;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false; // A path that is not there yet is simply not a directory.
  }
}

// ── the logger ───────────────────────────────────────────────────────────────────

export interface LoggerOptions {
  /** Where a log file goes, if the user asked for one. */
  readonly logPath?: string | undefined;
  /** Whether trace() output is shown on the terminal (-v). It always reaches the file. */
  readonly verbose?: boolean | undefined;
  /** Header lines for the log file: the command line, the resolved config, and so on. */
  readonly header?: readonly string[] | undefined;
}

export interface Logger {
  /** A result the user asked for: stdout. */
  info(message: string): void;
  /** Progress, warnings, anything that must not pollute stdout: stderr. */
  note(message: string): void;
  /** Diagnostics: terminal only under -v, always in the log file. */
  trace(message: string): void;
  /** Renders an error and returns the exit code to use. Never throws. */
  fail(e: unknown, ctx?: ErrorContext): number;
  /** Path of the log file, if one is open — worth telling the user about. */
  readonly logPath: string | undefined;
  close(): void;
}

/**
 * Open a logger. Creating the log file is done EAGERLY and its failure is loud: the user
 * asked for a log, so quietly not producing one is the wrong kind of mercy. It happens
 * before any real work for the same reason `--out` is checked before patching.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const verbose = options.verbose === true;
  let fd: number | null = null;
  const path = options.logPath;

  if (path !== undefined) {
    try {
      mkdirSync(dirOf(path), { recursive: true });
      // 0600: a log holds fragments of the user's source. It is their data, and nobody
      // else's business.
      fd = openSync(path, 'ax', 0o600);
    } catch (e) {
      throw new ConfigError(`cannot open log file '${path}': ${(e as Error).message}`);
    }
    for (const line of options.header ?? []) writeLine(fd, line);
  }

  const toFile = (channel: string, message: string): void => {
    if (fd !== null) for (const line of message.split('\n')) writeLine(fd, `${channel} ${line}`);
  };

  return {
    logPath: path,
    info(message: string): void {
      process.stdout.write(`${message}\n`);
      toFile('   ', message);
    },
    note(message: string): void {
      process.stderr.write(`${message}\n`);
      toFile('   ', message);
    },
    trace(message: string): void {
      if (verbose) process.stderr.write(`${message}\n`);
      toFile('dbg', message);
    },
    fail(e: unknown, ctx: ErrorContext = {}): number {
      const report = renderError(e, ctx);
      process.stderr.write(`${report}\n`);
      toFile('ERR', report);
      if (fd !== null) {
        process.stderr.write(`(full log: ${path})\n`);
      }
      return e instanceof HatchError ? e.exitCode : 1;
    },
    close(): void {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
    },
  };
}

function dirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut <= 0 ? '.' : path.slice(0, cut);
}

function writeLine(fd: number, line: string): void {
  writeSync(fd, `${line}\n`);
}

// ── rendering ────────────────────────────────────────────────────────────────────

export interface ErrorContext {
  /** Content of the file the pattern ran against — needed to turn offsets into lines. */
  readonly source?: string | undefined;
  /** Its path, for the first line of the report. */
  readonly sourcePath?: string | undefined;
  /** Path of the .md, for errors that point into it. */
  readonly mdPath?: string | undefined;
}

/**
 * A failure as a report, not a sentence. Every branch below exists because the one-line
 * version cost somebody an hour: a step number that names nothing, an offset printed as
 * a number, an ambiguity that does not say who it is ambiguous WITH.
 */
export function renderError(e: unknown, ctx: ErrorContext = {}): string {
  if (e instanceof MatchError) return renderMatchError(e, ctx);
  if (e instanceof AmbiguityError) return renderAmbiguityError(e, ctx);
  if (e instanceof ParseError) return renderParseError(e, ctx);
  if (e instanceof HatchError) return `${e.name}: ${e.message}`;
  return `error: ${(e as Error).message ?? String(e)}`;
}

function renderMatchError(e: MatchError, ctx: ErrorContext): string {
  const out = [`${e.name}: ${e.message}`];
  if (ctx.sourcePath !== undefined) out.push(`  file: ${ctx.sourcePath}`);

  const total = e.totalSteps;
  // Running PAST the last step is not "step N+1 of N": there is no such step, the
  // pattern simply ended. Saying it the other way round is what makes the hint below
  // land instead of reading like an off-by-one.
  out.push(
    total !== undefined && e.failedStepIndex >= total
      ? `  the pattern ended after its last step (${total} of ${total}), the file did not`
      : `  stopped at step ${e.failedStepIndex + 1}${total === undefined ? '' : ` of ${total}`}`,
  );

  if (e.matchedText !== undefined) {
    const at = where(ctx.source, e.matchedPos);
    out.push(`  last anchor that DID match${at.suffix}: ${quote(e.matchedText)}`);
  }
  if (e.anchorText !== undefined) {
    out.push(`  looking for:  ${quote(e.anchorText)}`);
  }
  const stuck = where(ctx.source, e.origPos);
  if (stuck.line !== undefined) {
    out.push(`  the file there${stuck.suffix}:`);
    out.push(...excerpt(ctx.source!, stuck.line));
  }
  if (e.hint !== undefined) out.push(...wrap(`hint: ${e.hint}`, '  '));
  return out.join('\n');
}

function renderAmbiguityError(e: AmbiguityError, ctx: ErrorContext): string {
  const out = [`${e.name}: ${e.message}`];
  if (ctx.sourcePath !== undefined) out.push(`  file: ${ctx.sourcePath}`);
  const labels = ['  it fits here:', '  and here:'];
  for (const [i, pos] of e.positions.entries()) {
    const at = where(ctx.source, pos);
    out.push(`${labels[i] ?? '  and here:'}${at.suffix}`);
    if (at.line !== undefined) out.push(...excerpt(ctx.source!, at.line));
  }
  out.push('  add context so the anchor picks one: another parent, a neighbour line, or');
  out.push('  spell out what the two places differ in.');
  return out.join('\n');
}

function renderParseError(e: ParseError, ctx: ErrorContext): string {
  const head = ctx.mdPath === undefined ? `${e.name}: ${e.message}` : `${e.name}: ${ctx.mdPath}: ${e.message}`;
  return head;
}

/** An offset as a place a human can go to. Absent source or offset → no claim made. */
function where(source: string | undefined, offset: number | undefined): { line?: number; suffix: string } {
  if (source === undefined || offset === undefined) return { suffix: '' };
  const line = lineOf(source, offset);
  const col = offset - lineStart(source, line);
  return { line, suffix: ` (line ${line + 1}, col ${col + 1})` };
}

function lineOf(source: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  for (let i = source.indexOf('\n'); i !== -1 && i < clamped; i = source.indexOf('\n', i + 1)) line++;
  return line;
}

function lineStart(source: string, line: number): number {
  let at = 0;
  for (let n = 0; n < line; n++) {
    const next = source.indexOf('\n', at);
    if (next === -1) break;
    at = next + 1;
  }
  return at;
}

/** The line itself, numbered, so the reader sees what the pattern was up against. */
function excerpt(source: string, line: number): string[] {
  const lines = source.split('\n');
  const text = lines[line] ?? '';
  const number = String(line + 1).padStart(6);
  return [`${number} | ${text}`];
}

/** Soft-wrap a long explanation so a report stays readable in a narrow terminal. */
function wrap(text: string, indent: string, width = 76): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && `${line} ${word}`.length > width) {
      out.push(indent + line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') out.push(indent + line);
  return out;
}

function quote(text: string): string {
  const oneLine = text.replace(/\n/g, '⏎');
  return `\`${oneLine.length > 90 ? `${oneLine.slice(0, 87)}…` : oneLine}\``;
}

// ── log file header ──────────────────────────────────────────────────────────────

/**
 * The first lines of a log file. A log that does not say what was run is an artefact
 * nobody can act on a week later.
 */
export function logHeader(command: string, argv: readonly string[], extra: readonly string[] = []): string[] {
  return [
    `# hatch ${command}`,
    `# when: ${new Date().toISOString()}`,
    `# cwd:  ${process.cwd()}`,
    `# argv: ${argv.join(' ')}`,
    ...extra.map((line) => `# ${line}`),
    '',
  ];
}
