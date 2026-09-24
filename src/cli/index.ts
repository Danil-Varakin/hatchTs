#!/usr/bin/env node
import { HatchError } from '../core/errors.ts';
import { renderError } from '../infra/log.ts';
import { CONFIG_VERSION } from '../infra/config/index.ts';
import { packageIdentity } from '../infra/version.ts';
import { invokedDirectly } from '../infra/entry.ts';

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

  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    const topic = first === 'help' ? rest[0] : undefined;
    const named = topic === undefined ? undefined : COMMANDS[topic];
    if (named !== undefined) {
      await (await named.load()).main(['--help']);
      return;
    }
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (first === '--version' || first === '-V' || first === 'version') {
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
  const pkg = packageIdentity();
  return `${pkg.name} ${pkg.version} (config schema v${CONFIG_VERSION})`;
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
