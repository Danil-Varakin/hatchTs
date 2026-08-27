import { mkdirSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { HatchError, MatchError, AmbiguityError, ParseError, ConfigError } from '../core/errors.ts';

// ── where a log file goes ────────────────────────────────────────────────────────

export const DEFAULT_LOG_DIR = 'hatch-logs';

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
    return false;
  }
}

// ── the logger ───────────────────────────────────────────────────────────────────

export interface LoggerOptions {
  readonly logPath?: string | undefined;
  readonly verbose?: boolean | undefined;
  readonly header?: readonly string[] | undefined;
}

export interface Logger {
  info(message: string): void;
  note(message: string): void;
  trace(message: string): void;
  fail(e: unknown, ctx?: ErrorContext): number;
  readonly logPath: string | undefined;
  close(): void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const verbose = options.verbose === true;
  let fd: number | null = null;
  const path = options.logPath;

  if (path !== undefined) {
    try {
      mkdirSync(dirOf(path), { recursive: true });
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
  readonly source?: string | undefined;
  readonly sourcePath?: string | undefined;
  readonly mdPath?: string | undefined;
}

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

function excerpt(source: string, line: number): string[] {
  const lines = source.split('\n');
  const text = lines[line] ?? '';
  const number = String(line + 1).padStart(6);
  return [`${number} | ${text}`];
}

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
