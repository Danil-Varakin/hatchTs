// generate/printer.ts — сборка готового .md из синтезированных ханков. Переиспользует
// core/hatch-printer (печать шаблона), добавляя обвязку `# match`/`# patch` + ограды
// ```lang, которую понимает parseHatchFile. Так замыкается round-trip .md: synth →
// printHatchFile → parseHatchFile даёт эквивалентные ханки.
import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';

/**
 * Собрать .md-документ из ханков. language (из адаптера/опции) идёт в ограду ```lang,
 * чтобы apply определил язык из самого файла. Ханки разделяются пустой строкой.
 */
export function printHatchFile(hunks: readonly Hunk[], language?: string): string {
  const fence = '```' + (language ?? '');
  return hunks
    .map((h) =>
      ['# match', fence, printPattern(h.match), '```', '# patch', fence, h.patch, '```'].join('\n'),
    )
    .join('\n\n') + '\n';
}
