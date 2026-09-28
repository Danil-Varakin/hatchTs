import { createLoggerOrWarn, logHeader, resolveLogPath } from '../infra/log.ts';
import type { ErrorContext, Logger } from '../infra/log.ts';
import { parseArgs } from './args.ts';
import type { ArgSpec } from './args.ts';

// What every command does around its own work, once: read the arguments (a slip is
// answered with the usage), `--help`, the logger and its `--log` file, and the one exit
// — an error rendered by infra/log.ts, its exit code from the error itself. A command
// brings only what is its own: the options it accepts and the run.

/** Options every command understands: `--help`, and `--log` where it is offered. */
export interface CommonOptions {
  help: boolean;
  log?: string;
}

export interface Command<T extends CommonOptions, Seen extends object> {
  readonly name: string;
  readonly usage: string;
  readonly spec: ArgSpec<T>;
  /** The defaults; copied for every call, never changed. */
  readonly initial: T;
  readonly verbose?: (opts: T) => boolean;
  /** `seen` starts empty on every call: the run records in it what an error report
   *  needs (the text an offset points into), `errorContext` reads it back. */
  readonly run: (opts: T, log: Logger, seen: Seen) => Promise<void>;
  readonly errorContext?: (opts: T, seen: Seen) => ErrorContext;
}

export async function runCommand<T extends CommonOptions, Seen extends object>(
  command: Command<T, Seen>,
  argv: readonly string[],
): Promise<void> {
  let opts: T;
  try {
    opts = parseArgs(argv, command.spec, { ...command.initial });
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n${command.usage}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    process.stdout.write(`${command.usage}\n`);
    return;
  }

  const log = createLoggerOrWarn({
    ...(opts.log !== undefined ? { logPath: resolveLogPath(opts.log, command.name) } : {}),
    ...(command.verbose !== undefined ? { verbose: command.verbose(opts) } : {}),
    header: logHeader(command.name, argv),
  });

  const seen = {} as Seen;
  try {
    await command.run(opts, log, seen);
    if (log.logPath !== undefined) log.note(`log: ${log.logPath}`);
  } catch (e) {
    process.exitCode = log.fail(e, command.errorContext?.(opts, seen));
  } finally {
    log.close();
  }
}
