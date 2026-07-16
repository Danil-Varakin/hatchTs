// core/patcher.ts — одна правка на ханк: канон-метки матчера → оригинальные
// смещения → вставка или замена в ТЕКУЩЕЙ строке исходника. Ровно ОДНА правка на
// ханк (парсер гарантирует один >>> и опционально один <<<), поэтому сортировки
// «с конца к началу» нет.
//
// Патчер НЕ проверяет, наложен ли патч уже: если матчер нашёл место — накладываем;
// если не нашёл — это MatchError уровнем выше. Состояние файла (пропатчен он или
// нет) — забота вызывающего пайплайна, не наша.
import type { SourceMap } from '../lang/source-map.ts';
import type { MatchMarks } from './matcher.ts';

/** Правка в ОРИГИНАЛЬНЫХ смещениях: заменить [start, end) на text. Вставка — start==end. */
export interface Edit {
  start: number; // смещение начала (>>> → toOriginalPos)
  end: number; // смещение конца (<<< → toOriginalPos); == start для чистой вставки
  text: string; // тело патча
}

/** Канон-позиции меток → оригинальная правка (перевод через map.toOriginalPos). */
export function planEdit(marks: MatchMarks, map: SourceMap, patch: string): Edit {
  const start = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  const end =
    marks.replaceEnd === undefined ? start : map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  if (end < start) {
    // Инвариант: <<< не может оказаться раньше >>> (парсер это запрещает, а метки
    // монотонны по канону). Если случилось — баг матчера/карты, не вход пользователя.
    throw new RangeError(`patcher: replace end ${end} is before insert start ${start}`);
  }
  return { start, end, text: patch };
}

/** Применить правку к строке (splice): вставка при start==end, иначе замена [start,end). */
export function applyEdit(source: string, edit: Edit): string {
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

/** Наложить один ханк: план правки → применение. Возвращает новый текст и правку. */
export function patchHunk(
  source: string,
  map: SourceMap,
  marks: MatchMarks,
  patch: string,
): { source: string; edit: Edit } {
  const edit = planEdit(marks, map, patch);
  return { source: applyEdit(source, edit), edit };
}
