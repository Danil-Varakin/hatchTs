// generate/diff.ts — обратная задача: построчный diff двух версий файла (jsdiff).
// Первый шаг конвейера generate (diff → synth → printer). Даёт synth АТОМАРНЫЕ
// единицы «одна правка = один Hatch-ханк» (changeSegments), а synth уже строит под
// каждую уникальный match-контекст по SourceMap. jsdiff — единственная точка
// зависимости от `diff`: весь остальной generate/ импортирует типы отсюда.
//
// ДВА СЛОЯ:
//   diffHunks     — сырой structuredPatch (unified-diff ханки с контекстом);
//                   примитив для диагностики / режима -a.
//   changeSegments — поверх него: разрез на атомарные правки. КАЖДЫЙ сегмент =
//                   ровно одна вставка / удаление / замена, т.е. ровно один
//                   Hatch-ханк (инвариант ядра «один >>> на ханк»). Разрез идёт по
//                   ЛЮБОМУ прогону неизменённых строк между группами -/+ — это
//                   максимально мелкие правки. Контекст в сегмент НЕ кладётся:
//                   якорь и его уникальность строит synth (соседи из old-исходника
//                   + подъём по enclosing). Соседние правки разводит последовательное
//                   применение (phase-3), поэтому дробить смело.
//
// КООРДИНАТЫ построчные, 1-based (как unified diff). В lines каждая строка несёт
// префикс-маркер ' '/'-'/'+' (плюс возможная служебная `\ No newline at end of file`).
import { structuredPatch } from 'diff';

/** Роль строки внутри ханка по её префиксу-маркеру (см. lineKind). */
export type LineKind = 'context' | 'del' | 'add' | 'eofnl';

/**
 * Один ханк построчного diff — по форме = StructuredPatchHunk jsdiff, но НАШ тип:
 * generate/ не тянет типы из пакета напрямую.
 *   oldStart/oldLines — начало (1-based) и длина ханка в СТАРОМ файле;
 *   newStart/newLines — то же в НОВОМ;
 *   lines — строки ханка с префиксом-маркером ' '/'-'/'+' (плюс возможный `\`).
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Одна АТОМАРНАЯ правка = ровно один Hatch-ханк. Смежный прогон изменённых строк
 * (возможно, сшитый через неизменённые разделители — см. SegmentOptions); контекст
 * не включён (его добавит synth). Вид правки читается по длинам: removed.length>0 &&
 * added.length>0 → замена; только added → вставка; только removed → удаление.
 *
 *   oldStart — 1-based строка СТАРОГО файла, с которой начинается правка. Для
 *              чистой вставки (removed.length===0) — строка, ПЕРЕД которой вставка
 *              (равно «после строки oldStart-1»).
 *   newStart — то же в НОВОМ файле.
 *   removed  — строки старого кода (без префикса), которые уходят; для вставки [].
 *   added    — строки нового кода (без префикса); для удаления [].
 *
 * При сшивке (bridge) неизменённые строки-разделители попадают И в removed, И в
 * added (одинаковый текст) — Hatch переизлучит их как есть; блок остаётся одним
 * ханком ценой чуть большего replace-диапазона.
 */
export interface ChangeSegment {
  oldStart: number;
  newStart: number;
  removed: string[];
  added: string[];
}

/**
 * Сырой построчный diff old→new (structuredPatch). context — сколько строк
 * окружения тянуть вокруг правок; влияет ТОЛЬКО на упаковку контекста и слияние
 * соседних правок в один ханк (порог context*2), не на состав правок. По умолчанию
 * 3. Идентичные файлы → [].
 */
export function diffHunks(oldStr: string, newStr: string, context = 3): DiffHunk[] {
  // Имена файлов и заголовки не нужны — работаем по позициям, не по шапке.
  const patch = structuredPatch('a', 'b', oldStr, newStr, '', '', { context });
  // Без maxEditLength overload всегда возвращает StructuredPatch (не undefined).
  return patch.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));
}

/**
 * Разрез old→new на атомарные правки. Базово: context=0, один прогон -/+ = один
 * сегмент (только изменённые строки, инвариант «одна правка на единицу»). Затем
 * СШИВКА соседних сегментов через короткие неизменённые разрывы — чтобы цельную
 * правку, разбитую случайно совпавшей строкой, собрать в один ханк.
 *
 * bridgeGap — бюджет сшивки: сколько неизменённых НЕПУСТЫХ строк подряд разрешено
 * втянуть в правку (случай `bar();` посреди замены). Пустые (визуальные) строки
 * бесплатны — мостятся ВСЕГДА, в бюджет не входят. Сшитые строки идут в replace как
 * есть. 0 (по умолч.) → мостить только пустые: строгий разрез по непустой неизменённой.
 * Идентичные файлы → [].
 */
export function changeSegments(oldStr: string, newStr: string, bridgeGap = 0): ChangeSegment[] {
  const base = baseSegments(oldStr, newStr);
  if (base.length === 0) return [];

  // Неизменённые строки-разрывы читаем прямо из старого исходника по номерам строк
  // (в base их нет — context=0). Слой синхронен по непробельным на обеих сторонах.
  const oldLines = oldStr.split('\n');
  const out: ChangeSegment[] = [];
  let merged = base[0]!;
  for (let i = 1; i < base.length; i++) {
    const next = base[i]!;
    const gapStart = merged.oldStart + merged.removed.length; // 1-based первая неизменённая
    const gap = oldLines.slice(gapStart - 1, next.oldStart - 1); // до начала next
    const nonBlank = gap.filter((line) => line.trim() !== '').length; // пустые бесплатны
    if (nonBlank <= bridgeGap) {
      // Сшиваем: неизменённые строки входят в ОБЕ стороны (переизлучатся как есть).
      merged = {
        oldStart: merged.oldStart,
        newStart: merged.newStart,
        removed: [...merged.removed, ...gap, ...next.removed],
        added: [...merged.added, ...gap, ...next.added],
      };
    } else {
      out.push(merged);
      merged = next;
    }
  }
  out.push(merged);
  return out;
}

/**
 * Базовый разрез: context=0 → ханки без контекста, внутри каждого только изменённые
 * строки, и один прогон -/+ = один сегмент. Без сшивки (её делает changeSegments).
 */
function baseSegments(oldStr: string, newStr: string): ChangeSegment[] {
  const segments: ChangeSegment[] = [];
  for (const h of diffHunks(oldStr, newStr, 0)) {
    // Курсоры строк (1-based) внутри ханка; идут синхронно по контексту.
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    let cur: ChangeSegment | null = null;
    const flush = () => {
      if (cur) {
        segments.push(cur);
        cur = null;
      }
    };
    for (const line of h.lines) {
      switch (lineKind(line)) {
        case 'eofnl':
          break; // служебный маркер: не строка исходника, курсоры не двигает
        case 'context':
          flush(); // неизменённая строка закрывает текущий сегмент
          oldLine++;
          newLine++;
          break;
        case 'del':
          cur ??= { oldStart: oldLine, newStart: newLine, removed: [], added: [] };
          cur.removed.push(lineText(line));
          oldLine++;
          break;
        case 'add':
          cur ??= { oldStart: oldLine, newStart: newLine, removed: [], added: [] };
          cur.added.push(lineText(line));
          newLine++;
          break;
      }
    }
    flush(); // хвостовой сегмент ханка
  }
  return segments;
}

/**
 * Роль строки ханка по её ПЕРВОМУ символу — это МАРКЕР diff, а не содержимое:
 *   ' ' → строка БЕЗ изменений (в терминах diff это «контекст» — окружение);
 *   '-' → удалённая (была в старом файле);
 *   '+' → добавленная (есть в новом);
 *   '\' → служебная «\ No newline at end of file» (не содержимое).
 */
export function lineKind(line: string): LineKind {
  switch (line[0]) {
    case '-':
      return 'del';
    case '+':
      return 'add';
    case '\\':
      return 'eofnl';
    case ' ':
      return 'context'; // маркер пробела = неизменённая строка (окружение правки)
    default:
      return 'context'; // строка без маркера (пустая) — трактуем как неизменённую
  }
}

/** Содержимое строки ханка без префикс-маркера (первого символа). */
export function lineText(line: string): string {
  return line.slice(1);
}
