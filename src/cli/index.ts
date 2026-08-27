import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HatchError } from '../core/errors.ts';
import { renderError } from '../infra/log.ts';
import { CONFIG_VERSION } from '../infra/config/schema.ts';

interface Command {
  readonly summary: string;
  readonly load: () => Promise<{ main: (argv: readonly string[]) => Promise<void> }>;
}

const COMMANDS: Readonly<Record<string, Command>> = {
  apply: {
    summary: 'apply .md instructions to a source file',
    load: () => import('./apply.ts'),
  },
  generate: {
    summary: 'synthesize .md instructions from two versions of a file',
    load: () => import('./generate.ts'),
  },
  grammars: {
    summary: 'put the tree-sitter grammars in place (the only command that goes online)',
    load: () => import('./grammars.ts'),
  },
};

const USAGE = `hatch — structural patch instructions in Markdown

  hatch <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(10)}${c.summary}`)
  .join('\n')}

  hatch <command> --help    options for that command
  hatch --version           version of hatch and of the config schema

Exit codes: 0 ok · 1 usage · 2 .md parse · 3 no match · 4 ambiguous · 5 config · 6 grammar`;

export async function main(argv: readonly string[]): Promise<void> {
  const [first, ...rest] = argv;

  if (first === undefined || first === '--help' || first === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (first === '--version' || first === '-V') {
    process.stdout.write(`${version()}\n`);
    return;
  }

  const command = COMMANDS[first];
  if (command === undefined) {
    const known = Object.keys(COMMANDS).join(', ');
    const hint = first.startsWith('-')
      ? `options come AFTER the command: hatch <command> ${first} …`
      : `known commands: ${known}`;
    process.stderr.write(`error: unknown command '${first}'\n  ${hint}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const module = await command.load();
    await module.main(rest);
  } catch (e) {
    process.stderr.write(`${renderError(e)}\n`);
    process.exitCode = e instanceof HatchError ? e.exitCode : 1;
  }
}

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as {
      version?: string;
      name?: string;
    };
    return `${pkg.name ?? 'hatch'} ${pkg.version ?? '0.0.0'} (config schema v${CONFIG_VERSION})`;
  } catch {
    return `hatch (version unknown; config schema v${CONFIG_VERSION})`;
  }
}

function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false; 
  }
}

if (invokedDirectly()) {
  await main(process.argv.slice(2));
}
