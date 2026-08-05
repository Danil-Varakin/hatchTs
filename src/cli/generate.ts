// cli/generate.ts — команда `generate`: из двух версий файла породить .md-инструкции.
//
// Обратный конвейер: diff → synth → printer. Старую версию берём из файла (--in-old)
// или из git-ветки (--branch). Язык — из --language или расширения --in. Результат в
// --out (или stdout). Режим -a: подтвердить каждый ханк перед записью. Режим -e:
// требовать дословного (байт в байт) воспроизведения new; без него достаточно
// ПОСТРОЧНОГО совпадения по нормализации языка — пробелы внутри строк не в счёт.
//
// Разбор аргументов свой (как в apply.ts — поверхность мала). Коды выхода из
// HatchError.exitCode (0 успех, 2 parse, 3 match, 4 ambiguity, 1 иное).
//
// Запуск:
//   node --experimental-strip-types src/cli/generate.ts \
//     --in new.cc (--in-old old.cc | --branch main) [--out patch.md] [--language cpp] [-a] [-e]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { synthesize } from '../generate/synth.ts';
import type { Tracer, SynthEvent } from '../generate/synth.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { printHatchFile, trailingSpaceWarnings } from '../generate/printer.ts';
import { reviewHunks } from '../generate/agreement.ts';
import type { Confirm } from '../generate/agreement.ts';
import { fileFromBranch } from '../infra/git.ts';
import { writeFileAtomic } from '../infra/fs.ts';
import { adapterForLanguage, adapterForFile } from '../lang/adapter.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';
import { HatchError } from '../core/errors.ts';

interface Options {
  in?: string;
  inOld?: string;
  branch?: string;
  out?: string;
  language?: string;
  agreement: boolean;
  exact: boolean;
  debug: boolean;
  help: boolean;
}

const USAGE = `hatch generate — synthesize .md instructions from two versions of a file

  --in,     -i <file>     new version of the file                    [required]
  --in-old     <file>     old version (from a file)      [one of --in-old/--branch]
  --branch, -b <branch>   old version = <branch>:<--in path> (git)
  --out,    -o <file>     write .md here (default: stdout)
  --language,-l <lang>    force language (else: extension of --in)
  --agreement,-a          confirm each hunk before writing
  --exact,  -e            reproduce the new file byte for byte; without it every
                          line only has to match after normalization (indentation
                          and inner spacing are free, the set of lines is not)
  --debug,  -v            trace synthesis to stderr: every segment, each probe
                          attempt (incl. non-unique) and the chosen hunk
  --help,   -h            this help`;

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { agreement: false, exact: false, debug: false, help: false };
  const takesValue: Record<string, 'in' | 'inOld' | 'branch' | 'out' | 'language'> = {
    '--in': 'in', '-i': 'in',
    '--in-old': 'inOld',
    '--branch': 'branch', '-b': 'branch',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--agreement' || a === '-a') opts.agreement = true;
    else if (a === '--exact' || a === '-e') opts.exact = true;
    else if (a === '--debug' || a === '-v') opts.debug = true;
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

// Метка языка для заголовка `# match <lang>`: --language, иначе расширение --in без точки.
function langLabel(opts: Options): string | undefined {
  if (opts.language !== undefined) return opts.language;
  const dot = opts.in!.lastIndexOf('.');
  return dot === -1 ? undefined : opts.in!.slice(dot + 1);
}

function resolveAdapter(opts: Options): LanguageAdapter {
  if (opts.language !== undefined) return adapterForLanguage(opts.language);
  return adapterForFile(opts.in!);
}

// Интерактивное подтверждение через stdin (ответы/подсказки — в stderr, чтобы не
// смешивать с .md в stdout).
function makeStdinConfirm(): { confirm: Confirm; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const confirm: Confirm = (question) =>
    new Promise((res) => {
      process.stderr.write(`\n${question}\n`);
      rl.question('keep this hunk? [Y/n] ', (a) => res(!/^\s*n/i.test(a)));
    });
  return { confirm, close: () => rl.close() };
}

// Отладочный трейсер (--debug): печатает ход синтеза в stderr, чтобы не смешаться с
// .md в stdout. Отступ pattern делает вложенность привязки наглядной.
function makeTracer(): Tracer {
  const indent = (s: string): string => s.replace(/^/gm, '        ');
  const kindOf = (e: Extract<SynthEvent, { kind: 'segment' }>): string =>
    e.seg.removed.length > 0 && e.seg.added.length > 0 ? 'replace' : e.seg.added.length > 0 ? 'insert' : 'delete';
  return (e) => {
    if (e.kind === 'segment') {
      process.stderr.write(`\n── segment #${e.index + 1} (${kindOf(e)}) @ old line ${e.seg.oldStart}\n`);
      for (const l of e.seg.removed) process.stderr.write(`   - ${l}\n`);
      for (const l of e.seg.added) process.stderr.write(`   + ${l}\n`);
    } else if (e.kind === 'attempt') {
      const tag =
        e.result === 'unique'
          ? '✓ unique'
          : e.result === 'ambiguous'
            ? `✗ ambiguous (${e.matches}+ matches — need more context)`
            : '∅ no match';
      process.stderr.write(`   try → ${tag}\n${indent(printPattern(e.pattern))}\n`);
    } else {
      process.stderr.write(`   ➜ CHOSEN, patch: ${JSON.stringify(e.patch)}\n`);
    }
  };
}

async function run(opts: Options): Promise<void> {
  if (opts.in === undefined) throw new Error('missing --in <file> (new version)');
  if ((opts.inOld === undefined) === (opts.branch === undefined)) {
    throw new Error('provide exactly one source of the OLD version: --in-old <file> OR --branch <branch>');
  }

  const newStr = readFileSync(opts.in, 'utf8');
  const oldStr =
    opts.inOld !== undefined ? readFileSync(opts.inOld, 'utf8') : await fileFromBranch(opts.branch!, opts.in);

  const adapter = resolveAdapter(opts);
  await adapter.init(); // разовая загрузка грамматики tree-sitter

  let hunks = synthesize(oldStr, newStr, adapter, {
    exact: opts.exact,
    trace: opts.debug ? makeTracer() : undefined,
  });

  if (opts.agreement) {
    const { confirm, close } = makeStdinConfirm();
    try {
      hunks = await reviewHunks(hunks, confirm);
    } finally {
      close();
    }
  }

  for (const w of trailingSpaceWarnings(hunks)) console.error(`warning: ${w}`);

  const md = printHatchFile(hunks, langLabel(opts));
  if (opts.out !== undefined) {
    writeFileAtomic(opts.out, md);
    console.error(`generated ${hunks.length} hunk(s) → ${opts.out}`);
  } else {
    process.stdout.write(md);
  }
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

// Запускать main() только при прямом вызове (не при импорте из тестов).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
