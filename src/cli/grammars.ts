import { pathToFileURL } from 'node:url';

import { adaptersByName } from '../lang/adapter.ts';
import { ensureGrammars, formatPin, locate, pinFor } from '../infra/grammar-store.ts';
import type { GrammarSource } from '../lang/source-map.ts';
import { HatchError } from '../core/errors.ts';

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

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { list: false, help: false };
  const takesValue: Record<string, 'language' | 'pin'> = {
    '--language': 'language', '-l': 'language',
    '--pin': 'pin',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      const key = takesValue[a];
      if (key === undefined) throw new Error(`unknown argument: ${a}`);
      const val = argv[++i];
      if (val === undefined) throw new Error(`option ${a} needs a value`);
      opts[key] = val;
    }
  }
  return opts;
}

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
    const source = await pinFor(opts.pin, { log: (m) => console.error(m) });
    console.log(formatPin(source));
    return;
  }

  const wanted = registeredGrammars(opts.language);
  if (wanted.length === 0) throw new Error(`unknown language '${opts.language}'`);

  if (opts.list) {
    for (const { names, grammar } of wanted) {
      const at = await locate(grammar);
      console.log(`${grammar.file.padEnd(30)} ${`${grammar.package}@${grammar.version}`.padEnd(46)} ${at ?? 'MISSING'}`);
      console.log(`  ${names.join(', ')}`);
    }
    return;
  }

  const statuses = await ensureGrammars(
    wanted.map((w) => w.grammar),
    { allowDownload: true, log: (m) => console.error(m) },
  );
  let fetched = 0;
  for (const [i, s] of statuses.entries()) {
    if (s.where === 'downloaded') fetched++;
    console.log(`${s.source.file.padEnd(30)} ${MB(s.bytes)}  ${s.where.padEnd(10)} (${wanted[i]!.names[0]})`);
  }
  console.error(`${statuses.length} grammar(s) ready, ${fetched} downloaded`);
}

export async function main(argv: readonly string[]): Promise<void> {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  try {
    await run(opts);
  } catch (e) {
    if (e instanceof HatchError) {
      console.error(`${e.name}: ${e.message}`);
      process.exitCode = e.exitCode;
    } else {
      console.error(`error: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
