// cli/apply.ts — команда `apply`: наложить .md-инструкции на исходник.
//
// Ханки применяются ПОСЛЕДОВАТЕЛЬНО, каждый против ТЕКУЩЕГО (уже изменённого)
// состояния: read → для каждого ханка buildMap(current) → matcher → patcher →
// current = правка. В конце ОДНА атомарная запись (temp+rename). Так ханк может
// зацепиться за то, что вставил предыдущий (00-general-rules §3, phase-3).
//
// Разбор аргументов — свой (без commander): поверхность мала. Коды выхода берутся
// из HatchError.exitCode (0 успех, 2 parse, 3 match, 4 ambiguity, 1 иное).
//
// Запуск:
//   node --experimental-strip-types src/cli/apply.ts \
//     --match patch.md --in src.cc --out out.cc [--language cpp] [--dry-run|--verify]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { matchPattern } from '../core/matcher.ts';
import { patchHunk } from '../core/patcher.ts';
import type { Edit } from '../core/patcher.ts';
import type { HatchFile } from '../core/ast.ts';
import { writeFileAtomic } from '../infra/fs.ts';
import { adapterForLanguage, adapterForFile } from '../lang/adapter.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';
import { HatchError } from '../core/errors.ts';

/** Одна применённая правка: сама правка и вырезанный текст (для показа замены). */
export interface AppliedEdit {
  edit: Edit;
  oldText: string; // вырезаемый текст (для замены; '' для чистой вставки)
}

/** Итог наложения всех ханков ПОСЛЕДОВАТЕЛЬНО (каждый против текущего состояния). */
export interface ApplyResult {
  source: string;
  edits: AppliedEdit[];
}

/**
 * Чистое ядро apply: наложить все ханки по очереди на source. Требует уже
 * инициализированного adapter (await adapter.init()). Без файлового ввода-вывода —
 * тестируется напрямую. Бросает MatchError/AmbiguityError матчера как есть.
 */
export function applyAll(source: string, file: HatchFile, adapter: LanguageAdapter): ApplyResult {
  let current = source;
  const edits: AppliedEdit[] = [];
  for (const hunk of file.hunks) {
    const map = adapter.buildMap(current); // карта ТЕКУЩЕГО текста (O(n) на ханк)
    const marks = matchPattern(hunk.match, map, adapter.normalize); // MatchError/AmbiguityError
    const result = patchHunk(current, map, marks, hunk.patch);
    edits.push({ edit: result.edit, oldText: current.slice(result.edit.start, result.edit.end) });
    current = result.source;
  }
  return { source: current, edits };
}

interface Options {
  match?: string;
  in?: string;
  out?: string;
  language?: string;
  dryRun: boolean;
  verify: boolean;
  help: boolean;
}

const USAGE = `hatch apply — apply .md instructions to a source file

  --match, -m <file.md>   patch instructions (match/patch hunks)   [required]
  --in,    -i <file>      source file to patch                     [required]
  --out,   -o <file>      where to write the result   [required unless --dry-run/--verify]
  --language, -l <lang>   force language (else: fence in .md, else file extension)
  --dry-run               show planned edits, write nothing
  --verify                exit code only (0 = applies cleanly), write nothing
  --help,  -h             this help`;

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { dryRun: false, verify: false, help: false };
  const takesValue: Record<string, 'match' | 'in' | 'out' | 'language'> = {
    '--match': 'match', '-m': 'match',
    '--in': 'in', '-i': 'in',
    '--out': 'out', '-o': 'out',
    '--language': 'language', '-l': 'language',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--verify') opts.verify = true;
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

// Язык: --language > fence в .md > расширение исходника.
function resolveAdapter(opts: Options, fenceLanguage: string | undefined): LanguageAdapter {
  if (opts.language !== undefined) return adapterForLanguage(opts.language);
  if (fenceLanguage !== undefined) return adapterForLanguage(fenceLanguage);
  return adapterForFile(opts.in!);
}

function describeEdit(applied: AppliedEdit, index: number, total: number): string {
  const { edit, oldText } = applied;
  const kind = edit.start === edit.end ? 'INSERT' : 'REPLACE';
  const where = edit.start === edit.end ? `@${edit.start}` : `[${edit.start}, ${edit.end})`;
  const old = edit.start === edit.end ? '' : `\n    old: ${JSON.stringify(oldText)}`;
  return `hunk ${index + 1}/${total}:\n  ${kind} ${where}\n    new: ${JSON.stringify(edit.text)}${old}`;
}

async function run(opts: Options): Promise<void> {
  if (opts.match === undefined) throw new Error('missing --match <file.md>');
  if (opts.in === undefined) throw new Error('missing --in <file>');
  const willWrite = !opts.dryRun && !opts.verify;
  if (willWrite && opts.out === undefined) {
    throw new Error('missing --out <file> (or use --dry-run / --verify)');
  }

  const file = parseHatchFile(readFileSync(opts.match, 'utf8')); // ParseError (exit 2)
  const adapter = resolveAdapter(opts, file.language);
  await adapter.init(); // разовая загрузка грамматики tree-sitter

  const source = readFileSync(opts.in, 'utf8');
  const { source: result, edits } = applyAll(source, file, adapter); // MatchError/AmbiguityError

  if (opts.dryRun) {
    for (const [i, e] of edits.entries()) console.log(describeEdit(e, i, edits.length));
    console.log(`dry-run: ${edits.length} hunk(s) would apply (nothing written)`);
    return;
  }
  if (opts.verify) {
    console.log(`verify: ok — ${edits.length} hunk(s) apply cleanly`);
    return;
  }
  writeFileAtomic(opts.out!, result);
  console.log(`applied ${edits.length} hunk(s) → ${opts.out}`);
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

// Запускать main() ТОЛЬКО когда файл вызван напрямую (node …/apply.ts), а не при
// импорте из тестов — иначе import выполнил бы CLI.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
