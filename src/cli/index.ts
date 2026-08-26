#!/usr/bin/env node
// src/cli/index.ts — the one entry point: `hatch <command> [options]`.
//
// It is a DISPATCHER and nothing else. Every command keeps its own argument parsing,
// its own USAGE and its own exit codes, because that is where the knowledge lives: teach
// this file what `--parents` means and `apply` starts pretending it understands a flag
// that has no meaning for it.
//
// What DOES belong here is the part that was copied into every command and drifted:
// the shebang, `--version`, the "unknown command" reply, and the single place that turns
// an escaped error into an exit code.
//
// No commander. The surface is three commands; a hand-written dispatch is smaller than
// the dependency and stays consistent with how each command already parses its own flags
// (docs/structure.md §6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HatchError } from '../core/errors.ts';
import { renderError } from '../infra/log.ts';
import { CONFIG_VERSION } from '../infra/config/schema.ts';

interface Command {
  readonly summary: string;
  /** Loaded on demand: `hatch --help` must not pay for tree-sitter or simple-git. */
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
    // A flag in the command slot is the common slip (`hatch --in x`), and it deserves a
    // different sentence than a misspelled command.
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
    // The commands report their own failures; anything arriving here escaped one of them
    // (a broken grammar load, a bad path) and would otherwise print as a bare stack.
    process.stderr.write(`${renderError(e)}\n`);
    process.exitCode = e instanceof HatchError ? e.exitCode : 1;
  }
}

/**
 * Version of the tool, and of the config schema next to it. Both, because "which hatch
 * is this" and "will it read my hatch.config.json" are the first two questions of any
 * report, and the answers move independently.
 *
 * The path is the same from `src/cli/` and from a built `dist/cli/`, which is why the
 * build needs no special case here.
 */
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
