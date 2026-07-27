// generate/synth.ts — обратная задача матчеру: разница двух версий файла → Hatch-ханки.
//
// Каждый ханк привязывается структурно: место правки описывается заголовками
// охватывающих конструкций (сигнатура функции, class, if) и ИХ ЗАКРЫВАШКАМИ —
// незакрытая `{` только упорядочивает, но не запирает (docs/matcher-window-stack.md
// §0.1), поэтому без закрывающего токена якорь-родитель не удерживает правку внутри
// себя. Уникальность добирается вложенными родителями, деталью якорей и соседними
// строками. Контекстные якоря обобщаются: нутро сбалансированных скобок заменяется
// на `...`, чтобы якорь пережил правку аргументов.
//
// Ханки строятся против текущего состояния файла (old + уже применённые ханки) и
// сразу применяются настоящим патчером; кандидат принимается, только если его
// применение воспроизводит ожидаемый результат. НАСКОЛЬКО точно — решает флаг
// exact (SynthOptions):
//   exact: true  — ДОСЛОВНО, байт в байт; нормализованное совпадение идёт лишь
//                  запасным вариантом, и итог сверяется с new посимвольно;
//   exact: false — по НОРМАЛИЗОВАННОМУ виду ПОСТРОЧНО (умолчание): отступы и лишние
//                  пробелы внутри строк в счёт не идут, но состав строк обязан
//                  сойтись. Лестница тогда останавливается на первом же рабочем
//                  шаблоне — он обычно короче, а дословность стоит лишних ступеней.
//
// Почему построчно, а не «нормализовать оба текста целиком»: normalize слеп к
// переводам строк, а конвейер на них держится — сегменты адресуются номерами строк
// (см. normalizedLines).
import type { MatchPattern, Step, Gap, Anchor, Hunk } from '../core/ast.ts';
import type { LanguageAdapter, SourceMap, BlockSpan } from '../lang/source-map.ts';
import { matchPattern } from '../core/matcher.ts';
import { patchHunk } from '../core/patcher.ts';
import { printPattern } from '../core/hatch-printer.ts';
import { AmbiguityError, MatchError } from '../core/errors.ts';
import { changeSegments } from './diff.ts';
import type { ChangeSegment } from './diff.ts';

/** Событие трейса (--debug): сегмент; проба привязки с исходом; выбранный ханк. */
export type SynthEvent =
  | { kind: 'segment'; index: number; seg: ChangeSegment }
  | { kind: 'attempt'; pattern: MatchPattern; result: 'unique' | 'ambiguous' | 'no-match'; matches: number }
  | { kind: 'hunk'; pattern: MatchPattern; patch: string };
export type Tracer = (event: SynthEvent) => void;

/** Настройки синтеза. Все поля необязательны — умолчания в normalizeOptions. */
export interface SynthOptions {
  /** Бюджет сшивки соседних правок в один ханк (см. changeSegments). По умолчанию 0. */
  bridgeGap?: number;
  /**
   * Требовать ДОСЛОВНОГО воспроизведения (байт в байт), а не построчно-канонического.
   * По умолчанию false: пробелы и отступы ВНУТРИ строк не считаются расхождением
   * (состав строк — считается всегда). Включай, когда важен ровно тот же файл —
   * форматтеры, whitespace-чувствительные тесты, языки со значащим отступом.
   */
  exact?: boolean;
  /** Трейсер хода синтеза (--debug). `| undefined` — чтобы звать с `debug ? f : undefined`. */
  trace?: Tracer | undefined;
}

type MatchMarks = ReturnType<typeof matchPattern>;

const MAX_NEIGHBOUR_ROWS = 3; // потолок добора соседями с каждой стороны (значащих строк)
const MAX_DETAIL_LEVELS = 2; // на сколько уровней вглубь можно РАСКРЫТЬ обобщённые скобки

// Всё, что нужно для построения одного ханка. Собирается один раз makeHunkContext,
// дальше только читается — поэтому функции построения не вложены, а берут ctx.
interface HunkContext {
  readonly segment: ChangeSegment;
  readonly adapter: LanguageAdapter;
  readonly source: string; // текущее состояние файла
  readonly map: SourceMap;
  readonly lines: string[];
  readonly lineStartOffsets: number[];
  readonly lineCount: number;
  readonly firstChangedRowIndex: number; // 0-based первая изменённая / точка вставки
  readonly rowIndexAfterChange: number; // 0-based первая строка после правки
  readonly changeStartOffset: number; // смещение начала изменённых строк
  readonly changeEndOffset: number; // смещение конца изменённых строк
  // КАНОН-границы правки: первый значащий символ правки и первый значащий ПОСЛЕ неё.
  // Именно по ним (а не по номерам строк) определяются края файла и блока: пустые
  // строки сверху/снизу канон не видит, поэтому canonStart===0 — честное «выше нет
  // ничего значащего», а canonEnd===eof — «ниже нет ничего значащего».
  readonly canonStart: number;
  readonly canonEnd: number;
  readonly parents: readonly BlockSpan[]; // охватывающие блоки С ЗАГОЛОВКОМ, внутрь→наружу
  readonly intendedSource: string; // source с этим сегментом (по границам строк)
  readonly normalizedIntendedLines: readonly string[]; // канон intendedSource ПОСТРОЧНО
  readonly requireExact: boolean; // сверять применение дословно, а не построчно
  readonly trace: Tracer | undefined;
}

// Найденный и проверенный ханк вместе с результатом его применения.
interface ResolvedHunk {
  readonly pattern: MatchPattern;
  readonly patch: string;
  readonly appliedSource: string;
}

/**
 * Породить ханки из (oldSource, newSource). adapter уже инициализирован (await init()).
 * Гарантия (проверяется внутри): применение ханков к oldSource даёт newSource — при
 * options.exact ДОСЛОВНО, иначе с точностью до нормализации языка (пробелы/отступы).
 */
export function synthesize(
  oldSource: string,
  newSource: string,
  adapter: LanguageAdapter,
  options: SynthOptions = {},
): Hunk[] {
  const { bridgeGap = 0, exact = false, trace } = options;
  const segments = changeSegments(oldSource, newSource, bridgeGap);
  const hunks: Hunk[] = [];

  let currentSource = oldSource;
  let rowShift = 0; // сдвиг номеров строк от применённых ханков (added - removed)

  for (const [index, originalSegment] of segments.entries()) {
    trace?.({ kind: 'segment', index, seg: originalSegment });
    const segment: ChangeSegment = { ...originalSegment, oldStart: originalSegment.oldStart + rowShift };

    const context = makeHunkContext(segment, currentSource, adapter, newSource.endsWith('\n'), exact, trace);
    const resolved = resolveHunk(context);

    hunks.push({ match: resolved.pattern, patch: resolved.patch });
    currentSource = resolved.appliedSource;
    rowShift += segment.added.length - segment.removed.length;
  }

  // Финальный рубеж той же строгости, что и приёмка кандидатов. exact — дословно:
  // иначе .md, отличающийся от new отступами, уходил бы наружу молча. Без exact
  // расхождение по пробелам ВНУТРИ строк не считается — сверять их здесь значило бы
  // отвергать ханки, которые сами же и приняли; но состав строк обязан сойтись.
  const reproduced = exact
    ? currentSource === newSource
    : sameByLines(normalizedLines(currentSource, adapter), normalizedLines(newSource, adapter));
  if (!reproduced) {
    throw new Error(
      `synth: result differs from new (${hunks.length} hunk(s), ${exact ? 'verbatim' : 'normalized'} check)`,
    );
  }
  return hunks;
}

function makeHunkContext(
  segment: ChangeSegment,
  source: string,
  adapter: LanguageAdapter,
  newEndsWithNewline: boolean,
  requireExact: boolean,
  trace: Tracer | undefined,
): HunkContext {
  const lineStartOffsets = getLineStartOffsets(source);
  const lineCount = lineStartOffsets.length - 1;
  const firstChangedRowIndex = segment.oldStart - 1;
  const rowIndexAfterChange = firstChangedRowIndex + segment.removed.length;
  // Инвариант, а не молчаливый undefined: oldStart 1-based, правка обязана лежать в
  // файле. Нарушение — баг диффа/сдвига строк, и без проверки он утёк бы дальше
  // как `lineStartOffsets[-1] → undefined → slice(0, undefined) → весь файл`.
  if (firstChangedRowIndex < 0 || rowIndexAfterChange > lineCount) {
    throw new Error(
      `synth: segment outside the file (oldStart=${segment.oldStart}, removed=${segment.removed.length}, lines=${lineCount})`,
    );
  }
  const changeStartOffset = lineStartOffsets[firstChangedRowIndex]!;
  const changeEndOffset = lineStartOffsets[rowIndexAfterChange]!;
  const map = adapter.buildMap(source);
  const canonStart = map.toCanonPos(changeStartOffset);
  const canonEnd = map.toCanonPos(changeEndOffset);

  // Терминатор последней добавленной строки. Обычно `\n`, но если правка упирается в
  // КОНЕЦ файла, а новый файл переводом строки не кончается — его быть не должно
  // (иначе ханк допишет лишний `\n`, и результат разойдётся с new на один байт).
  const endsFile = changeEndOffset === source.length;
  const terminator = endsFile && !newEndsWithNewline ? '' : '\n';
  const addedBlock = segment.added.length > 0 ? segment.added.join('\n') + terminator : '';
  const intendedSource = source.slice(0, changeStartOffset) + addedBlock + source.slice(changeEndOffset);

  return {
    segment,
    adapter,
    source,
    map,
    lines: source.split('\n'),
    lineStartOffsets,
    lineCount,
    firstChangedRowIndex,
    rowIndexAfterChange,
    changeStartOffset,
    changeEndOffset,
    canonStart,
    canonEnd,
    // Родители — блоки, охватывающие правку ЦЕЛИКОМ и выразимые текстом:
    //   close >= canonEnd — правка не съедает закрывашку самого блока (удаление `};`
    //     уничтожает блок: закрывать в шаблоне нечего, якорем снизу он тоже не будет);
    //   headerStart есть  — голый вложенный блок описать текстом нечем: его `{` в
    //     шаблон не попадёт, а значит и `}` в конце вешать не на что.
    // Граница НЕстрогая: у чистой вставки canonEnd === canonStart, и блок, на чьей
    // закрывашке она стоит (вставка в конец блока), проходит по равенству — карта
    // считает закрывашку частью СВОЕГО блока (inside = (open, close]). У замены же
    // canonEnd > canonStart, поэтому блок, кончающийся на её первом символе, из
    // родителей выпадает — правка его как раз и сносит.
    parents: map
      .enclosing(canonStart)
      .filter((span) => span.headerStart !== undefined && span.close >= canonEnd),
    intendedSource,
    normalizedIntendedLines: normalizedLines(intendedSource, adapter),
    requireExact,
    trace,
  };
}

// ── подбор и проверка кандидатов ──────────────────────────────────────────────────

// Перебрать кандидатов по возрастанию контекста; вернуть первого, чьё применение
// воспроизводит изменение.
//
// requireExact — вернуть первого ДОСЛОВНОГО. Кандидат, совпавший лишь построчно (рез
// лёг на другую границу пробелов — отступы поедут), придерживается запасным и берётся,
// только если дословного не нашлось вовсе.
// Без requireExact построчного совпадения достаточно: берём первого же рабочего и
// лестницу дальше не крутим — она бы только добирала контекст ради пробелов.
function resolveHunk(context: HunkContext): ResolvedHunk {
  let fallback: ResolvedHunk | undefined;
  let lastFailure: unknown;
  const tried = new Set<string>();

  for (const pattern of candidatePatterns(context)) {
    const signature = printPattern(pattern);
    if (tried.has(signature)) continue; // ступени лестницы схлопываются — не перепроверяем
    tried.add(signature);

    const attempt = verifyPattern(context, pattern);
    if ('failure' in attempt) {
      lastFailure = attempt.failure;
      continue;
    }
    if (attempt.exact || !context.requireExact) {
      context.trace?.({ kind: 'hunk', pattern, patch: attempt.hunk.patch });
      return attempt.hunk;
    }
    fallback ??= attempt.hunk;
  }

  if (fallback !== undefined) {
    context.trace?.({ kind: 'hunk', pattern: fallback.pattern, patch: fallback.patch });
    return fallback;
  }
  throw lastFailure ?? new AmbiguityError('synth: could not anchor the change with available context', []);
}

type Attempt = { hunk: ResolvedHunk; exact: boolean } | { failure: unknown };

// Проба одного шаблона: матч → патч из меток → применение патчером → сверка с
// ожидаемым результатом. Не совпал/неоднозначен/не воспроизвёл — failure.
function verifyPattern(context: HunkContext, pattern: MatchPattern): Attempt {
  const { map, adapter, source, trace } = context;
  let marks: MatchMarks;
  try {
    marks = matchPattern(pattern, map, adapter.normalize);
  } catch (error) {
    if (error instanceof MatchError) {
      trace?.({ kind: 'attempt', pattern, result: 'no-match', matches: 0 });
      return { failure: error };
    }
    if (error instanceof AmbiguityError) {
      trace?.({ kind: 'attempt', pattern, result: 'ambiguous', matches: error.positions.length });
      return { failure: error };
    }
    throw error;
  }
  trace?.({ kind: 'attempt', pattern, result: 'unique', matches: 1 });

  const cut = computeCutRange(marks, map);
  const patch = extractReplacementText(context.intendedSource, source, cut.startOffset, cut.endOffset);
  const appliedSource = patchHunk(source, map, marks, patch).source;
  if (appliedSource === context.intendedSource) {
    return { hunk: { pattern, patch, appliedSource }, exact: true };
  }
  if (!sameByLines(normalizedLines(appliedSource, adapter), context.normalizedIntendedLines)) {
    return { failure: new MatchError('anchor matched but did not reproduce the change', cut.startOffset, 0) };
  }
  return { hunk: { pattern, patch, appliedSource }, exact: false };
}

// Канон исходника ПОСТРОЧНО: normalize применяется к каждой строке отдельно, границы
// строк сохраняются. Сверять целиком нормализованные тексты нельзя — normalize слеп к
// переводам строк (в C++ они просто пробелы), поэтому ханк, съевший или дописавший
// ЦЕЛУЮ строку, прошёл бы такую сверку как «то же самое». А следующие сегменты
// адресуются номерами строк (segment.oldStart + rowShift, где сдвиг = added−removed):
// уехавшая на строку разметка ломает адресацию, и падает уже СОСЕДНИЙ ханк — далеко от
// места, где приняли слишком щедрого кандидата.
function normalizedLines(text: string, adapter: LanguageAdapter): string[] {
  return text.split('\n').map((line) => adapter.normalize(line));
}

function sameByLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

// Оригинальные смещения реза [start, end) из канонических меток.
function computeCutRange(marks: MatchMarks, map: SourceMap): { startOffset: number; endOffset: number } {
  const startOffset = map.toOriginalPos(marks.insert.pos, marks.insert.side);
  const endOffset = marks.replaceEnd === undefined ? startOffset : map.toOriginalPos(marks.replaceEnd.pos, marks.replaceEnd.side);
  return { startOffset, endOffset };
}

// Текст замены для реза [start, end): соответствующий фрагмент нового файла. Метки
// стоят на неизменном контексте/краях правки, поэтому префикс до start и суффикс после
// end у source и intendedSource совпадают — искомый фрагмент лежит между теми же
// позициями в intendedSource, со сдвигом хвоста на разницу длин.
function extractReplacementText(intendedSource: string, source: string, startOffset: number, endOffset: number): string {
  const suffixLength = source.length - endOffset;
  return intendedSource.slice(startOffset, intendedSource.length - suffixLength);
}

// ── лестница кандидатов ───────────────────────────────────────────────────────────

// Шаблоны по возрастанию «стоимости». Ленивый генератор: строится ровно столько,
// сколько успеет проверить resolveHunk (обычно 1–2), а не весь список.
//
// ВНЕШНИЙ цикл — форма реза (от предпочтительной к запасной), ВНУТРЕННИЙ — добор
// контекста. Не наоборот: запасные формы опираются на соседей, и при обратном порядке
// сосед вытеснял бы родителя уже на первой ступени, а родитель устойчивее (§0.1).
function* candidatePatterns(context: HunkContext): Generator<MatchPattern> {
  for (const cut of cutForms(context)) yield* contextLadder(context, cut);
}

// Лестница добора контекста для ОДНОЙ формы реза:
//   1) добор РОДИТЕЛЕЙ (ближний→дальний) — самая устойчивая привязка (§0.1);
//   2) раскрытие ДЕТАЛИ обобщённых скобок — уточняем сам якорь, а не тащим соседей;
//   3) добор СОСЕДЕЙ вверх/вниз — последнее средство, соседи дрейфуют.
function* contextLadder(context: HunkContext, cut: Cut): Generator<MatchPattern> {
  const parentCount = context.parents.length;
  // Ближайший родитель входит в шаблон С НУЛЕВОЙ ступени, даже когда правка уникальна
  // сама по себе: «голый минимум» (`... >>> target = 1; <<< ...`) структуры не несёт
  // вовсе и на дрейфе спокойно ложится в другую функцию — а привязка обязана быть
  // СТРУКТУРНОЙ (§0.1). Цена — каждый ханк тащит заголовок родителя и его закрывашку.
  const minParents = Math.min(1, parentCount);

  for (let parents = minParents; parents <= parentCount; parents++) {
    yield* patternFor(context, cut, parents, 0, 1, 0);
  }
  for (let detail = 1; detail <= MAX_DETAIL_LEVELS; detail++) {
    yield* patternFor(context, cut, parentCount, detail, 1, 0);
  }
  for (let distance = 1; distance <= 2 * MAX_NEIGHBOUR_ROWS - 1; distance++) {
    for (let extraAbove = 0; extraAbove <= Math.min(distance, MAX_NEIGHBOUR_ROWS - 1); extraAbove++) {
      const below = distance - extraAbove;
      if (below > MAX_NEIGHBOUR_ROWS) continue;
      yield* patternFor(context, cut, parentCount, 0, 1 + extraAbove, below);
    }
  }
  // Последнее средство — вообще без родителей. Сюда доходим, только если ни одна
  // структурная привязка не легла: разбор поехал (ERROR-узлы на макросах) или
  // родительские формы не воспроизводят правку дословно.
  if (minParents > 0) yield* patternFor(context, cut, 0, 0, 1, 0);
}

// Одна ступень: фиксированы и форма реза, и контекст. Сосед сверху идёт в лид, только
// если форма на него опирается; так же и якорь снизу — он нужен лишь формам с правой
// меткой (иначе шаблон таскал бы лишний контекст).
function* patternFor(
  context: HunkContext,
  cut: Cut,
  parentCount: number,
  detail: number,
  aboveRows: number,
  belowRows: number,
): Generator<MatchPattern> {
  const lead = buildLead(context, parentCount, detail, cut.needsAbove ? aboveRows : 0);
  const tail = buildTail(context, parentCount, detail, cut.pinsRight ? Math.max(belowRows, 1) : belowRows);
  const pattern = assemblePattern(context, lead, cut, tail);
  if (pattern !== null) yield pattern;
}

// ── формы реза ────────────────────────────────────────────────────────────────────

// Как ханк описывает МЕСТО правки.
//   needsAbove — форма опирается на якорь ПЕРЕД правкой (левая метка на курсоре);
//   pinsRight  — форма опирается на якорь ПОСЛЕ правки (он обязан стоять ровно на
//                границе изменения, иначе рез съест лишнее);
//   allowEdge  — засчитывать ли за такой якорь КРАЙ ФАЙЛА (начало / EOF) вместо
//                настоящего литерала. См. cutForms: для вставки край — законная
//                семантика, для замены/удаления — последнее средство.
type Cut =
  | { kind: 'insert'; side: 'left' | 'right'; needsAbove: boolean; pinsRight: boolean; allowEdge: boolean }
  | { kind: 'exact'; needsAbove: false; pinsRight: false; allowEdge: boolean }
  | { kind: 'context'; needsAbove: true; pinsRight: true; allowEdge: boolean }
  | { kind: 'contextBelow'; needsAbove: false; pinsRight: true; allowEdge: boolean }
  | { kind: 'contextAbove'; needsAbove: true; pinsRight: false; allowEdge: boolean }
  | { kind: 'span'; needsAbove: true; pinsRight: true; allowEdge: boolean };

// Формы в порядке предпочтения.
//
// ВСТАВКА в начало файла / дозапись в конец — по смыслу ПОЗИЦИОННЫЕ: «в начало» и
// значит в начало, что там лежит — неважно. Поэтому краю файла тут разрешено быть
// якорем (`>>> ...`, `... >>>`), и такой шаблон ложится всегда.
//
// УДАЛЕНИЕ/ЗАМЕНА первой (последней) строки — НЕ «правка начала (конца) файла», а
// правка КОНКРЕТНЫХ строк, которая просто оказалась с краю: сверху или снизу могут
// дописать что угодно, и ханк обязан это пережить. Поэтому такие резы держатся за
// содержимое:
//   `>>> removed ... <<< B` — соседа сверху нет, левый край реза = сам removed;
//   `A >>> removed <<<`     — соседа снизу нет, правый край реза = сам removed.
// Край файла для них — последнее средство (когда дословно иначе не воспроизвести).
//
// Исключение — ЗАМЕНА ВСЕГО ФАЙЛА: она позиционна ровно так же, как вставка в начало
// («снести всё, что есть»), поэтому `>>> ... <<<` идёт первым.
function* cutForms(context: HunkContext): Generator<Cut> {
  const { segment, map, parents, canonStart, canonEnd } = context;

  if (segment.removed.length === 0) {
    // Точка вставки стоит НА закрывашке ближайшего родителя = вставка в конец блока.
    // Равенство здесь возможно только потому, что это ветка ЧИСТОЙ вставки: canonEnd
    // === canonStart, и фильтр родителей (close >= canonEnd) пропускает блок по
    // равенству. У замены такой родитель отфильтрован — она бы его снесла.
    const atBlockEnd = parents.length > 0 && canonStart === parents[0]!.close;
    const atFileEnd = canonStart === map.eof;
    const toLeft: Cut = { kind: 'insert', side: 'left', needsAbove: true, pinsRight: false, allowEdge: true };
    const toRight: Cut = { kind: 'insert', side: 'right', needsAbove: false, pinsRight: true, allowEdge: true };
    // В конце блока/файла якорь снизу (`}`, EOF) устойчивее последнего оператора.
    if (atBlockEnd || atFileEnd) yield* [toRight, toLeft];
    else yield* [toLeft, toRight];
    // Запасная форма: чистая точка `>>>` режет ровно на границе пробелов, а метка
    // канонична — поэтому она НЕ воспроизводит вставку дословно, когда отступ новой
    // строки отличается от соседского или сверху пустая строка. Тогда берём рез по
    // ЗАЗОРУ между соседями: оба конца в неизменном тексте, значит патч точен.
    // Форма менее чистая (у вставки появляется `<<<`), поэтому она последняя.
    yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
    return;
  }

  // Весь значащий файл целиком: `>>> ... <<<` короче и честнее, чем литерал во весь файл.
  if (canonStart === 0 && canonEnd === map.eof) {
    yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
  }
  if (segment.added.length > 0 && preservesBoundaryWhitespace(segment.removed, segment.added)) {
    yield { kind: 'exact', needsAbove: false, pinsRight: false, allowEdge: false };
  }
  yield { kind: 'context', needsAbove: true, pinsRight: true, allowEdge: false };
  yield { kind: 'contextBelow', needsAbove: false, pinsRight: true, allowEdge: false };
  yield { kind: 'contextAbove', needsAbove: true, pinsRight: false, allowEdge: false };
  yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: false };
  // Досюда доходим, только если настоящих якорей не хватило: правка упирается в край
  // файла, и описать её иначе нечем.
  yield { kind: 'context', needsAbove: true, pinsRight: true, allowEdge: true };
  yield { kind: 'span', needsAbove: true, pinsRight: true, allowEdge: true };
}

// Сборка шаблона: `<lead> <рез> <tail>`. Метки живут на зазорах: левая — на курсоре
// (сразу за последним якорем лида), правая — на найденном якоре хвоста. Возвращает
// null, если форма на этом контексте невыразима.
function assemblePattern(context: HunkContext, lead: Step[], cut: Cut, tail: Tail): MatchPattern | null {
  const [first, ...rest] = tail.steps;
  const head = first!;

  // Левая метка отсчитывается от конца лида, правая садится на первый якорь хвоста
  // (он обязан стоять ровно там, где кончается правка, иначе рез съест лишнее).
  // Настоящий якорь — литерал; край файла (пустой лид / EOF в хвосте) засчитывается,
  // только если форма это разрешает (см. cutForms).
  const hasLeft = lead.length > 0 || (cut.allowEdge && context.canonStart === 0);
  const hasRight =
    tail.startCanon === context.canonEnd && (cut.allowEdge || head.anchor.target === 'literal');
  if (cut.needsAbove && !hasLeft) return null;
  if (cut.pinsRight && !hasRight) return null;

  // Снимаемое как литерал: пустое по канону (сняли пустую строку) — не литерал, а
  // ничто, такие резы невыразимы (их закрывает форма `span`).
  const removedAnchor = (): Anchor | null =>
    literalAnchor(context, context.segment.removed.join('\n'));
  // Рез, начинающийся с самого removed: зазор с ПРАВОЙ меткой ищется, поэтому левый
  // край реза = найденная позиция removed, а не курсор. Соседа сверху не требует.
  const fromRemoved = (anchor: Anchor): Step => ({ gap: markedGap(skipGap(), ['insert', 'right']), anchor });
  // Рез, начинающийся за соседом сверху: tight — снимаемое идёт ВСТЫК за лидом,
  // иначе рез поехал бы по строкам.
  const afterLead = (anchor: Anchor): Step => ({ gap: markedGap(tightGap(), ['insert', 'left']), anchor });

  switch (cut.kind) {
    case 'insert':
      return pattern(context, lead, [withMarks(head, ['insert', cut.side]), ...rest]);

    case 'exact': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [fromRemoved(removed), withMarks(head, ['replaceEnd', 'left']), ...rest]);
    }
    case 'context': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [afterLead(removed), withMarks(head, ['replaceEnd', 'right']), ...rest]);
    }
    case 'contextBelow': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [fromRemoved(removed), withMarks(head, ['replaceEnd', 'right']), ...rest]);
    }
    case 'contextAbove': {
      const removed = removedAnchor();
      if (removed === null) return null;
      return pattern(context, lead, [afterLead(removed), withMarks(head, ['replaceEnd', 'left']), ...rest]);
    }
    case 'span':
      return pattern(context, lead, [withMarks(head, ['insert', 'left'], ['replaceEnd', 'right']), ...rest]);
  }
}

// Собрать шаблон и, если лид пуст, а правка упирается в начало файла, сделать первый
// зазор встык: шаблон без ведущего `...` требует лечь с позиции 0 (§0.3) — это и есть
// привязка к началу файла вместо «где-то там». Два исключения: EOF-якорь (встык к
// нему — это «файл пуст», а не «правка в начале») и зазор с ПРАВОЙ меткой (в .md
// сторона метки читается по наличию `...`, и tight превратил бы её в левую).
function pattern(context: HunkContext, lead: Step[], rest: Step[]): MatchPattern {
  const steps = [...lead, ...rest];
  const head = steps[0]!;
  const tightenable =
    lead.length === 0 &&
    context.canonStart === 0 &&
    head.anchor.target === 'literal' &&
    head.gap.mode.op === 'skipAny' &&
    !hasRightMark(head.gap);
  if (tightenable) steps[0] = { gap: { ...head.gap, mode: { op: 'tight' } }, anchor: head.anchor };
  return { steps };
}

// ── лид и хвост ───────────────────────────────────────────────────────────────────

// Лид: заголовки parentCount охватывающих конструкций (наружу→внутрь) + сосед сверху.
// Соседа нет (правка — первое значащее в блоке/файле) — не беда: тогда роль «якоря
// слева» играет сам заголовок родителя (или начало файла).
function buildLead(context: HunkContext, parentCount: number, detail: number, aboveRows: number): Step[] {
  const steps: Step[] = [];
  for (let i = parentCount - 1; i >= 0; i--) steps.push(...headerSteps(context, context.parents[i]!, detail));
  steps.push(...neighbourStepsAbove(context, aboveRows, detail));
  return steps;
}

// Хвост шаблона: [сосед снизу] + закрывашки взятых родителей (внутрь→наружу) + `...`.
// startCanon — позиция первого якоря хвоста: по ней проверяется, что правая метка
// сядет ровно на границу правки. Соседа и закрывашку различать не нужно — и то и
// другое просто «первый якорь после правки» (в языке без закрывающего токена
// закрывашек не будет вовсе, хвост тогда упрётся в `...`).
interface Tail {
  readonly steps: Step[];
  readonly startCanon: number;
}

function buildTail(context: HunkContext, parentCount: number, detail: number, belowRows: number): Tail {
  const steps: Step[] = [];
  let startCanon: number | null = null;

  if (belowRows > 0) {
    const below = neighbourStepsBelow(context, belowRows, detail);
    if (below.length > 0) {
      steps.push(...below);
      startCanon = context.canonEnd;
    }
  }
  for (let i = 0; i < parentCount; i++) {
    const closer = closerStep(context, context.parents[i]!);
    if (closer === null) break; // язык без закрывающего токена — дальше закрывать нечем
    steps.push(closer);
    startCanon ??= context.parents[i]!.close;
  }
  steps.push(skipStep(EOF_ANCHOR));
  return { steps, startCanon: startCanon ?? context.map.eof };
}

// Якорь-родитель — заголовок узла [headerStart, open]: сигнатура функции, `class Foo`,
// `if (...)`, а не «строка со скобкой». Заголовок кончается открывашкой — так матчер
// в момент совпадения кладёт закрывашку блока в свой стек (advance), и хвостовой `}`
// достаётся обязательством, а не поиском.
function headerSteps(context: HunkContext, span: BlockSpan, detail: number): Step[] {
  const { map } = context;
  const from = map.toOriginalPos(span.headerStart ?? span.open, 'right');
  const to = map.toOriginalPos(span.open + 1, 'left');
  return stepsForRange(context, from, to, detail);
}

// Закрывающий токен родителя как якорь: текст [close, closeEnd) из карты, а не «строка
// с `}`» — иначе в литерал уезжали бы `};`, `} else {` и хвостовые комментарии.
function closerStep(context: HunkContext, span: BlockSpan): Step | null {
  if (span.closeEnd === undefined) return null;
  const { map, source } = context;
  const raw = source.slice(map.toOriginalPos(span.close, 'right'), map.toOriginalPos(span.closeEnd, 'left'));
  const anchor = literalAnchor(context, raw);
  return anchor === null ? null : skipStep(anchor);
}

// ── соседние строки ───────────────────────────────────────────────────────────────

// Соседи сверху: aboveRows ЗНАЧАЩИХ строк над правкой, не выше содержимого ближайшего
// родителя (пустые строки бесплатны и в счёт не идут). Верхняя граница — позиция за
// открывашкой родителя, а НЕ начало его строки: иначе сосед повторил бы текст, уже
// съеденный якорем-заголовком, и шаблон потребовал бы вторую `{`.
function neighbourStepsAbove(context: HunkContext, rows: number, detail: number): Step[] {
  const { parents, map, lines, lineStartOffsets, firstChangedRowIndex } = context;
  const limit = parents.length > 0 ? map.toOriginalPos(parents[0]!.open + 1, 'right') : 0;

  let row = firstChangedRowIndex;
  let taken = 0;
  while (row > 0 && taken < rows && lineStartOffsets[row - 1]! >= limit) {
    row--;
    if (!isBlankLine(lines[row])) taken++;
  }
  // Бюджет не выбран — значит упёрлись в границу родителя (или в начало файла):
  // берём всё до неё, включая хвост строки, на которой родитель открылся.
  const from = taken < rows ? limit : Math.max(lineStartOffsets[row]!, limit);
  return stepsForRange(context, from, context.changeStartOffset, detail);
}

// Соседи снизу: rows значащих строк под правкой, не ниже закрывашки ближайшего
// родителя (сама закрывашка приходит отдельным шагом хвоста, см. buildTail).
function neighbourStepsBelow(context: HunkContext, rows: number, detail: number): Step[] {
  const { parents, map, lines, lineStartOffsets, lineCount, rowIndexAfterChange } = context;
  const limit = parents.length > 0 ? map.toOriginalPos(parents[0]!.close, 'right') : context.source.length;

  let row = rowIndexAfterChange;
  let taken = 0;
  while (row < lineCount && taken < rows && lineStartOffsets[row]! < limit) {
    if (!isBlankLine(lines[row])) taken++;
    row++;
  }
  const to = Math.min(taken < rows ? limit : lineStartOffsets[row]!, limit);
  return stepsForRange(context, context.changeEndOffset, to, detail);
}

// ── обобщённые якоря ──────────────────────────────────────────────────────────────

// Шаги якоря для ОРИГИНАЛЬНОГО диапазона [from, to): нутро сбалансированных скобок →
// `...`. Каждый непустой сегмент — шаг `... <литерал>`. Пустые скобки (`foo()`)
// остаются как есть. Отбор скобок — по карте, не по тексту.
//   detail — сколько уровней скобок оставить НЕобобщёнными: 0 → `foo( ... )`,
//   1 → `foo(bar( ... ))`. Лестница поднимает detail, когда обобщённый якорь оказался
//   неоднозначным: уточнять сам якорь честнее, чем тащить соседей (§0.1).
function stepsForRange(context: HunkContext, from: number, to: number, detail: number): Step[] {
  if (to <= from) return [];
  const { map } = context;
  const canonFrom = map.toCanonPos(from);
  const canonTo = map.toCanonPos(to);
  if (canonTo <= canonFrom) return []; // в диапазоне нет ничего значащего

  const steps: Step[] = [];
  let cursor = canonFrom;
  for (const bracket of bracketsToGeneralize(map, canonFrom, canonTo, detail)) {
    appendLiteralSegment(context, steps, cursor, bracket.open + 1); // сегмент до открывашки включительно
    cursor = bracket.close; // возобновляем на закрывашке
  }
  appendLiteralSegment(context, steps, cursor, canonTo);
  return steps;
}

// Скобки, чьё нутро схлопывается в `...`: глубина вложенности >= detail, непустые,
// не лежащие внутри уже схлопнутых. blocksWithin отдаёт пролёты по open возрастающе,
// поэтому вложенность считается одним стеком за проход.
function bracketsToGeneralize(map: SourceMap, canonFrom: number, canonTo: number, detail: number): BlockSpan[] {
  const out: BlockSpan[] = [];
  const open: number[] = []; // close-ы ещё не закрытых пролётов
  for (const span of map.blocksWithin(canonFrom, canonTo)) {
    while (open.length > 0 && open[open.length - 1]! <= span.open) open.pop();
    const depth = open.length;
    open.push(span.close);
    if (span.close <= span.open + 1) continue; // пустые скобки — обобщать нечего
    if (depth < detail) continue; // этот уровень оставляем видимым
    if (out.length > 0 && span.open < out[out.length - 1]!.close) continue; // внутри уже схлопнутых
    out.push(span);
  }
  return out;
}

// Литерал канон-сегмента [canonFrom, canonTo). Начало доводится до начала СТРОКИ,
// если левее в ней только пробелы: ведущий отступ значим для языков с отступами
// (в Python он и есть маркер уровня), а языки, где он не значим, выкинут его сами
// в normalize. Литерал без значащего текста шагом не становится.
function appendLiteralSegment(context: HunkContext, steps: Step[], canonFrom: number, canonTo: number): void {
  if (canonTo <= canonFrom) return;
  const { source, map, lineStartOffsets } = context;
  let start = map.toOriginalPos(canonFrom, 'right');
  const end = map.toOriginalPos(canonTo, 'left');
  const lineStart = lineStartOffsets[findRowIndexAt(lineStartOffsets, start)]!;
  if (source.slice(lineStart, start).trim() === '') start = lineStart;

  const anchor = literalAnchor(context, source.slice(start, end));
  if (anchor !== null) steps.push(skipStep(anchor));
}

// Якорь-литерал или null, если текст пуст по канону языка. Пустой литерал — не
// «пустой якорь», а невыразимый: матчер на нём падает контрактной ошибкой карты.
function literalAnchor(context: HunkContext, raw: string): Anchor | null {
  if (context.adapter.normalize(raw) === '') return null;
  return { target: 'literal', literal: { raw, mdSpan: [0, 0] } };
}

// ── строки, пробелы ─────────────────────────────────────────────────────────────

// Смещения начал строк. Длина = число строк + 1; последний элемент = text.length
// (сентинел), поэтому диапазон любой строки [offsets[row], offsets[row+1]) валиден.
function getLineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) offsets.push(i + 1);
  if (offsets[offsets.length - 1] !== text.length) offsets.push(text.length);
  return offsets;
}

// Индекс строки, содержащей смещение (наибольшая строка, чьё начало ≤ offset).
function findRowIndexAt(lineStartOffsets: number[], offset: number): number {
  let lo = 0;
  let hi = lineStartOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStartOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function isBlankLine(line: string | undefined): boolean {
  return (line ?? '').trim() === '';
}

// Сохраняет ли removed-бракетинг границы: ведущий отступ первой строки удержан, а
// хвостовой пробел последней совпадает у removed и added (иначе рез по removed их
// не тронет, и отступ/хвост поехали бы).
function preservesBoundaryWhitespace(removed: string[], added: string[]): boolean {
  return (
    added[0]!.startsWith(getLeadingWhitespace(removed[0]!)) &&
    getTrailingWhitespace(removed[removed.length - 1]!) === getTrailingWhitespace(added[added.length - 1]!)
  );
}

function getLeadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}
function getTrailingWhitespace(line: string): string {
  return /[ \t]*$/.exec(line)![0];
}

// ── конструкторы шагов ────────────────────────────────────────────────────────────

const EOF_ANCHOR: Anchor = { target: 'eof' };

type Mark = ['insert' | 'replaceEnd', 'left' | 'right'];

function skipGap(): Gap {
  return { mode: { op: 'skipAny' } };
}
function tightGap(): Gap {
  return { mode: { op: 'tight' } };
}
function markedGap(gap: Gap, ...marks: Mark[]): Gap {
  for (const [mark, side] of marks) gap[mark] = { side, mdLine: 0 };
  return gap;
}
function hasRightMark(gap: Gap): boolean {
  return gap.insert?.side === 'right' || gap.replaceEnd?.side === 'right';
}
function skipStep(anchor: Anchor): Step {
  return { gap: skipGap(), anchor };
}
// Копия шага с метками: шаги лида/хвоста переиспользуются между формами реза одной
// ступени, поэтому метки нельзя дописывать в общий зазор — только в свежий.
function withMarks(step: Step, ...marks: Mark[]): Step {
  return { gap: markedGap({ mode: step.gap.mode }, ...marks), anchor: step.anchor };
}
