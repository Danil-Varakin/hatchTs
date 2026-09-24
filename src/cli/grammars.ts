import { adaptersByName } from '../lang/adapter.ts';
import { ensureGrammars, formatPin, locate, pinFor } from '../infra/grammar-store.ts';
import type { GrammarSource } from '../lang/source-map.ts';
import { HatchError, LanguageError } from '../core/errors.ts';
import { invokedDirectly } from '../infra/entry.ts';
import { parseArgs } from './args.ts';
import type { ArgSpec } from './args.ts';

interface Options {
  language?: string;
  pin?: string;
  list: boolean;
  help: boolean;
}

const USAGE = `hatch grammars — fetch the tree-sitter grammars languages need

Grammars are not kept in the repository. This command puts them in the shared user
cache; afterwards apply and generate work offline.

  (no arguments)          fetch every registered grammar that is missing
  --language, -l <lang>   only this language's grammar
  --list                  what is registered, and where each grammar sits now
  --pin <pkg@version>     download and print the declaration block (file, package,
                          version, sha256) to paste into a new language's index.ts
  --help,     -h          this help`;

const SPEC: ArgSpec<Options> = {
  flags: { '--list': 'list', '--help': 'help', '-h': 'help' },
  values: { '--language': 'language', '-l': 'language', '--pin': 'pin' },
};

export function registeredGrammars(language?: string): { names: string[]; grammar: GrammarSource }[] {
  const byFile = new Map<string, { names: string[]; grammar: GrammarSource }>();
  for (const [name, adapter] of adaptersByName()) {
    if (language !== undefined && name !== language.trim().toLowerCase()) continue;
    const entry = byFile.get(adapter.grammar.file);
    if (entry === undefined) byFile.set(adapter.grammar.file, { names: [name], grammar: adapter.grammar });
    else entry.names.push(name);
  }
  return [...byFile.values()];
}

const MB = (bytes: number): string => `${(bytes / 1048576).toFixed(2).padStart(5)} MB`;

async function run(opts: Options): Promise<void> {
  if (opts.pin !== undefined) {
    const source = await pinFor(opts.pin, { log: (m) => process.stderr.write(`${m}\n`) });
    process.stdout.write(`${formatPin(source)}\n`);
    return;
  }

  const wanted = registeredGrammars(opts.language);
  if (wanted.length === 0) {
    throw new LanguageError(
      `unknown language '${opts.language}'`,
      opts.language !== undefined ? { language: opts.language } : {},
    );
  }

  if (opts.list) {
    for (const { names, grammar } of wanted) {
      const at = await locate(grammar);
      const pin = `${grammar.package}@${grammar.version}`;
      process.stdout.write(`${grammar.file.padEnd(30)} ${pin.padEnd(46)} ${at ?? 'MISSING'}\n`);
      process.stdout.write(`  ${names.join(', ')}\n`);
    }
    return;
  }

  const statuses = await ensureGrammars(
    wanted.map((w) => w.grammar),
    { allowDownload: true, log: (m) => process.stderr.write(`${m}\n`) },
  );
  let fetched = 0;
  for (const [i, s] of statuses.entries()) {
    if (s.where === 'downloaded') fetched++;
    process.stdout.write(`${s.source.file.padEnd(30)} ${MB(s.bytes)}  ${s.where.padEnd(10)} (${wanted[i]!.names[0]})\n`);
  }
  process.stderr.write(`${statuses.length} grammar(s) ready, ${fetched} downloaded\n`);
}

export async function main(argv: readonly string[]): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(argv, SPEC, { list: false, help: false });
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  try {
    await run(opts);
  } catch (e) {
    if (e instanceof HatchError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      process.exitCode = e.exitCode;
    } else {
      process.stderr.write(`error: ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  }
}

if (invokedDirectly(import.meta.url)) {
  await main(process.argv.slice(2));
}
