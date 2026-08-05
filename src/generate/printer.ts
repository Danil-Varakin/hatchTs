// generate/printer.ts — сборка готового .md из синтезированных ханков. Переиспользует
// core/hatch-printer (печать шаблона), добавляя обвязку `# match <lang>` / `# patch` /
// `# end` и жёлоб в четыре пробела, которую понимает parseHatchFile. Так замыкается
// round-trip .md: synth → printHatchFile → parseHatchFile даёт эквивалентные ханки.
import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';

const GUTTER = '    ';

/**
 * Собрать .md-документ из ханков. language (из адаптера/опции) идёт в заголовок
 * `# match <lang>`, чтобы apply определил язык из самого файла. Ханки разделяются
 * пустой строкой — она вне блоков, потому что каждый блок закрыт `# end`.
 */
export function printHatchFile(hunks: readonly Hunk[], language?: string): string {
  const head = language !== undefined && language !== '' ? `# match ${language}` : '# match';
  return (
    hunks
      .map((h) =>
        [
          head,
          ...gutter(printPattern(h.match)),
          '# end',
          '# patch',
          ...gutter(h.patch),
          '# end',
        ].join('\n'),
      )
      .join('\n\n') + '\n'
  );
}

// Пустая строка нагрузки печатается ПУСТОЙ, а не жёлобом: границу блока держит `# end`,
// поэтому значащих хвостовых пробелов в .md не появляется и стриппер их не тронет.
function gutter(text: string): string[] {
  if (text === '') return [];
  return text.split('\n').map((l) => (l === '' ? '' : GUTTER + l));
}

/**
 * Хвостовые пробелы в теле патча значимы (тело применяется дословно), но от мусора
 * неотличимы для любого whitespace-fix. Единственное место в формате, где правка .md
 * посторонним инструментом молча меняет результат, — поэтому предупреждаем в момент
 * порождения, а не когда упадёт тест на выходном файле.
 */
export function trailingSpaceWarnings(hunks: readonly Hunk[]): string[] {
  const out: string[] = [];
  for (const [i, h] of hunks.entries()) {
    const n = h.patch.split('\n').filter((l) => /[ \t]$/.test(l)).length;
    if (n > 0) {
      out.push(
        `hunk ${i + 1}: patch body has ${n} line(s) ending in whitespace — significant, ` +
          'do not run a trailing-whitespace fixer on this .md',
      );
    }
  }
  return out;
}
