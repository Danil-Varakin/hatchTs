// core/matcher.ts — ТОНКИЙ интерпретатор шаблона против SourceMap (в КАНОНЕ).
//
// Полный дизайн (обязательство/поиск, живая/просроченная запись стека, строгая
// уникальность) — docs/matcher-window-stack.md §0. Ключевые принципы:
//   • НИКАКОГО распознавания скобок: ни одного `case '}'`. Открытие/исполнение
//     блоков — сравнения чисел; пары {open, close} посчитаны картой при buildMap.
//   • Шаблон описывает файл ЦЕЛИКОМ, `...` — единственный пропуск. Нет `...` в
//     начале → первый литерал с позиции 0 (это даёт tight-шаг сам). Нет `...` в
//     хвосте → последний литерал у EOF (это даёт финальная проверка pos == eof).
//   • Незакрытая `{` УПОРЯДОЧИВАЕТ («якорь ПОСЛЕ `{`»), а не запирает: поиск идёт
//     до конца файла, «побег» из открытого блока легален (оставляет просрочку).
//   • Матч НЕ уникален (две ветки с разной итоговой правкой) → AmbiguityError.
import type { MatchPattern, Gap, Literal } from './ast.ts';
import type { SourceMap } from '../lang/source-map.ts';
import { MatchError, AmbiguityError } from './errors.ts';

/** Найденная метка в КАНОНИЧЕСКИХ координатах (перевод в оригинал — в патчере). */
export interface LocatedMark {
  pos: number;
  side: 'left' | 'right';
}

/** Результат матча: позиции меток ханка (insert обязателен, replaceEnd опционален). */
export interface MatchMarks {
  insert: LocatedMark;
  replaceEnd?: LocatedMark;
}

// Внутреннее накопление меток по ходу обхода (insert может ещё не проставиться).
interface Marks {
  insert?: LocatedMark;
  replaceEnd?: LocatedMark;
}

/**
 * Сопоставить шаблон с картой файла. Возвращает канон-позиции меток либо бросает
 * MatchError (нет совпадения) / AmbiguityError (два разных совпадения).
 * `normalize` — канонизатор литералов языка (из адаптера); кешируется на прогон.
 */
export function matchPattern(
  pattern: MatchPattern,
  map: SourceMap,
  normalize: (raw: string) => string,
): MatchMarks {
  const steps = pattern.steps;
  const eof = map.eof;

  // Канон литерала считается ОДИН раз на литерал (а не на каждой попытке отката).
  const normCache = new Map<Literal, string>();
  const normOf = (lit: Literal): string => {
    let n = normCache.get(lit);
    if (n === undefined) {
      n = normalize(lit.raw);
      normCache.set(lit, n);
    }
    return n;
  };

  // Собранные РАЗНЫЕ правки (по сигнатуре меток). Две → неоднозначность.
  const edits = new Map<string, MatchMarks>();
  let stop = false; // найдено 2 разных правки → дальше не ищем
  let deepestPos = -1; // самая глубокая достигнутая позиция при отказе (диагностика)
  let deepestStep = 0;
  const recordDeepest = (pos: number, i: number): void => {
    if (pos > deepestPos) {
      deepestPos = pos;
      deepestStep = i;
    }
  };

  // ЕДИНСТВЕННАЯ точка сдвига курсора. Чистая: не мутирует входной стек, возвращает
  // новый. ИСПОЛНЕНИЕ — pop записей, НАКРЫТЫХ текстом литерала (A <= close < B);
  // «прошёл мимо» (close < A) НЕ снимает — запись остаётся просроченной уликой.
  // ОТКРЫТИЕ — push close пролётов, чей open съеден литералом (C++: open >= A;
  // Python получит включительную границу open <= B в своей фазе).
  const advance = (norm: string, A: number, stack: readonly number[]): { pos: number; stack: number[] } => {
    const B = A + norm.length;
    const s = stack.slice();
    while (s.length > 0 && s[s.length - 1]! >= A && s[s.length - 1]! < B) s.pop();
    const entered = map.enclosing(B).filter((sp) => sp.open >= A);
    for (let k = entered.length - 1; k >= 0; k--) s.push(entered[k]!.close); // наружу→внутрь
    return { pos: B, stack: s };
  };

  // Литерал [p, p+len) ЗАКРЫВАЮЩИЙ: накрывает close блока, ОТКРЫТОГО снаружи него.
  // enclosing(p) уже даёт пролёты с open < p <= close; остаётся close < p+len.
  const isCloser = (p: number, len: number): boolean =>
    map.enclosing(p).some((s) => s.close < p + len);

  // Проставить метки зазора данной стороны в позицию at (возвращает НОВЫЙ объект).
  const applySide = (marks: Marks, gap: Gap, side: 'left' | 'right', at: number): Marks => {
    let m = marks;
    if (gap.insert !== undefined && gap.insert.side === side) m = { ...m, insert: { pos: at, side } };
    if (gap.replaceEnd !== undefined && gap.replaceEnd.side === side) m = { ...m, replaceEnd: { pos: at, side } };
    return m;
  };

  // Сигнатура правки — по позициям/сторонам меток (уникальность считается ПО
  // ПРАВКЕ, не по пути обхода: ветки с одинаковой правкой = один матч).
  const signature = (m: Marks): string =>
    `${m.insert?.pos ?? ''}:${m.insert?.side ?? ''}|${m.replaceEnd?.pos ?? ''}:${m.replaceEnd?.side ?? ''}`;

  const recordFull = (m: Marks): void => {
    const sig = signature(m);
    if (!edits.has(sig)) {
      edits.set(sig, m as MatchMarks); // insert гарантирован парсером (ровно один >>>)
      if (edits.size >= 2) stop = true;
    }
  };

  // Обойти steps[i..] от (pos, stack, marks). Возвращает: найден ли хотя бы один
  // полный матч в этом поддереве (для правила «обязательство безальтернативно»).
  const walk = (i: number, pos: number, stack: number[], marks: Marks): boolean => {
    if (stop) return edits.size > 0;

    if (i === steps.length) {
      // Финал: шаблон описал файл целиком → курсор обязан стоять на EOF.
      if (pos !== eof) {
        recordDeepest(pos, i);
        return false;
      }
      recordFull(marks);
      return true;
    }

    const { gap, anchor } = steps[i]!;
    const mL = applySide(marks, gap, 'left', pos); // левые метки — на текущем курсоре

    if (anchor.target === 'eof') {
      if (gap.mode.op === 'skipAny') {
        // Хвостовой `...`: БЕЗУСЛОВНЫЙ прыжок в eof (непустой/просроченный стек легален).
        const mR = applySide(mL, gap, 'right', eof);
        return walk(i + 1, eof, stack, mR);
      }
      return walk(i + 1, pos, stack, mL); // tight+eof: финал проверит pos == eof
    }

    const norm = normOf(anchor.literal);

    if (gap.mode.op === 'tight') {
      // Встык: литерал обязан совпасть прямо на курсоре.
      if (!map.matchesAt(norm, pos)) {
        recordDeepest(pos, i);
        return false;
      }
      const adv = advance(norm, pos, stack);
      return walk(i + 1, adv.pos, adv.stack, mL); // tight → правых меток нет
    }

    // skipAny + литерал: сначала ОБЯЗАТЕЛЬСТВО, при провале — ПОИСК.
    const W = stack.length > 0 ? stack[stack.length - 1]! : -1;
    const obligation = stack.length > 0 && W >= pos && map.matchesAt(norm, W);
    if (obligation) {
      // Вершина живая и совпала: пара выбрана деревом — берём безальтернативно.
      const mR = applySide(mL, gap, 'right', W);
      const adv = advance(norm, W, stack);
      if (walk(i + 1, adv.pos, adv.stack, mR)) return true; // остаток достроился → коммит
      if (stop) return edits.size > 0;
      // остаток провалился → откат к поиску (W исключаем — уже пробовали)
    }

    let found = false;
    let sawCandidate = false;
    for (const p of map.occurrences(norm, pos, eof)) {
      if (obligation && p === W) continue; // уже испробовано обязательством
      // Закрывашка нелегальна, если прыжок к p оставляет позади несомкнутый блок,
      // ОТКРЫТЫЙ шаблоном (запись стека c < p): нельзя закрыть внешний/поздний
      // блок, бросив открытым более ранний. Просрочку создаёт сам прыжок к p,
      // поэтому сравниваем с p, а не с текущим pos (docs/matcher-window-stack §0.3).
      if (isCloser(p, norm.length) && stack.some((c) => c < p)) continue;
      sawCandidate = true;
      const mR = applySide(mL, gap, 'right', p);
      const adv = advance(norm, p, stack);
      if (walk(i + 1, adv.pos, adv.stack, mR)) found = true;
      if (stop) return edits.size > 0;
    }
    if (!found && !sawCandidate && !obligation) recordDeepest(pos, i);
    return found;
  };

  walk(0, 0, [], {});

  if (edits.size === 0) {
    throw new MatchError(
      `no match: the pattern did not fit the file (deepest progress at step ${deepestStep})`,
      deepestPos < 0 ? 0 : deepestPos,
      deepestStep,
    );
  }
  if (edits.size >= 2) {
    const positions = [...edits.values()].map((m) => map.toOriginalPos(m.insert.pos, m.insert.side));
    throw new AmbiguityError(
      'ambiguous match: the pattern fits in more than one place — add context',
      positions,
    );
  }
  return [...edits.values()][0]!;
}
