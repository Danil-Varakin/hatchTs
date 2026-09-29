import { join, resolve } from 'node:path';
import { ConfigError } from '../core/errors.ts';
import { CONFIG_FILE_NAME, CONFIG_VERSION, configTemplate, suggestedConfigPath } from '../infra/config/index.ts';
import { checkParent, isFile, writeFileAtomic } from '../infra/fs.ts';
import { invokedDirectly } from '../infra/entry.ts';
import type { ArgSpec } from './args.ts';
import { runCommand } from './command.ts';

interface Options {
  configVersion?: string;
  dir?: string;
  force: boolean;
  dryRun: boolean;
  help: boolean;
}

const USAGE = `hatch init — write a hatch.config.json

Writes only "$schema" and "version": every other key keeps the built-in default until
you set it, so a later change of a default reaches the project.

  --config-version <n>  config schema to write (default: the newest this hatch reads)
  --dir <dir>           where to write it (default: the root of the git repository
                        around the current directory; outside one, the directory itself)
  --force               replace an existing hatch.config.json
  --dry-run             print the file to stdout, write nothing
  --help, -h            this help`;

const SPEC: ArgSpec<Options> = {
  flags: { '--force': 'force', '--dry-run': 'dryRun', '--help': 'help', '-h': 'help' },
  values: { '--config-version': 'configVersion', '--dir': 'dir' },
};

async function run(opts: Options): Promise<void> {
  const version = opts.configVersion === undefined ? undefined : asNumber(opts.configVersion);
  const template = configTemplate({ version });

  if (opts.dryRun) {
    process.stdout.write(template.text);
  } else {
    const target = opts.dir !== undefined ? join(resolve(opts.dir), CONFIG_FILE_NAME) : suggestedConfigPath(process.cwd());
    if (isFile(target) && !opts.force) {
      throw new ConfigError('already exists — nothing written; --force replaces it', target);
    }
    checkParent(target);
    writeFileAtomic(target, template.text);
    process.stderr.write(`wrote ${target}\n`);
  }
  const note = olderSchemaNote(template.version);
  if (note !== undefined) process.stderr.write(`${note}\n`);
}

/** One line when the schema written is not the newest; nothing otherwise. */
export function olderSchemaNote(written: number): string | undefined {
  return written < CONFIG_VERSION ? `wrote config schema v${written}; the newest is v${CONFIG_VERSION}` : undefined;
}

/** Digits become a number; anything else is passed on as it is, for the schema check
 *  to refuse with the range in its message. */
function asNumber(raw: string): unknown {
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function main(argv: readonly string[]): Promise<void> {
  return runCommand(
    { name: 'init', usage: USAGE, spec: SPEC, initial: { force: false, dryRun: false, help: false }, run },
    argv,
  );
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
