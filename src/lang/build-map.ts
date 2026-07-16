// lang/build-map.ts — ОБЩИЙ: собирает SourceMap из канона + пролётов блоков.
// Всё в КАНОНИЧЕСКИХ координатах; в оригинал переводит только toOriginalPos (через canon).
// Кривой вход (pos вне [0,eof], пустой литерал, from>to) — баг вызывающего: бросаем.
import type { Canon } from './canon.ts';
import type { SourceMap, BlockSpan } from './source-map.ts';
import { isWordChar } from './word.ts';

export function makeSourceMap(canon: Canon, spans: readonly BlockSpan[]): SourceMap {
  const text = canon.text;
  const eof = text.length;

  const assertPos = (pos: number, name: string): void => {
    if (!Number.isInteger(pos) || pos < 0 || pos > eof) {
      throw new RangeError(`SourceMap: ${name}=${pos} out of [0, ${eof}]`);
    }
  };
  const assertNorm = (norm: string): void => {
    if (norm.length === 0) throw new Error('SourceMap: empty literal');
  };

  // «внутри блока» = зазор в (open, close]: курсор вошёл, ПРОЙДЯ '{', и остаётся до
  // '}'. Глубина меняется ПОСЛЕ прохода скобки — отсюда несимметричные '<' и '<='.
  const inside = (s: BlockSpan, pos: number): boolean => s.open < pos && pos <= s.close;

  const depthOf = (pos: number): number => {
    let d = 0;
    for (const s of spans) if (inside(s, pos)) d++;
    return d;
  };

  return {
    eof,

    matchesAt(norm: string, pos: number): boolean {
      assertNorm(norm);
      assertPos(pos, 'pos');
      return text.startsWith(norm, pos) && boundaryOk(text, norm, pos);
    },

    // ЧИСТО ТЕКСТОВЫЕ вхождения: старт в [from, to] — to ВКЛЮЧИТЕЛЬНО (литерал
    // `}`/`} else {` начинается прямо на закрывающем токене); хвост может выходить
    // за to. Фильтра глубины НЕТ — структурный отбор делает матчер (обязательство/
    // поиск, docs/matcher-window-stack.md §0; он зовёт с to=eof, окна-стены нет).
    occurrences(norm: string, from: number, to: number): number[] {
      assertNorm(norm);
      assertPos(from, 'from');
      assertPos(to, 'to');
      if (from > to) throw new RangeError(`SourceMap: from=${from} > to=${to}`);
      const out: number[] = [];
      for (let p = text.indexOf(norm, from); p !== -1 && p <= to; p = text.indexOf(norm, p + 1)) {
        if (boundaryOk(text, norm, p)) out.push(p);
      }
      return out;
    },

    enclosingEnd(pos: number): number {
      assertPos(pos, 'pos');
      let bestOpen = -1;
      let end = eof;
      for (const s of spans) {
        if (inside(s, pos) && s.open > bestOpen) {
          bestOpen = s.open;
          end = s.close;
        }
      }
      return end;
    },

    depthAt(pos: number): number {
      assertPos(pos, 'pos');
      return depthOf(pos);
    },

    // Пролёты ЦЕЛИКОМ ({open, close}): пары уже посчитаны при сборке карты, матчер
    // берёт close для стека окон в момент съедания open — искать пару не нужно.
    enclosing(pos: number): BlockSpan[] {
      assertPos(pos, 'pos');
      const out: BlockSpan[] = [];
      for (const s of spans) if (inside(s, pos)) out.push({ open: s.open, close: s.close });
      // ВНУТРЬ→НАРУЖУ: ближайший (самый глубокий) блок первым. Больший open =
      // позже открылся = глубже вложен. Порядок под synth (phase-4): он берёт
      // ближайший контекст вокруг правки и расширяет наружу до уникальности.
      out.sort((a, b) => b.open - a.open);
      return out;
    },

    toOriginalPos(pos: number, side: 'left' | 'right'): number {
      assertPos(pos, 'pos');
      if (side !== 'left' && side !== 'right') throw new Error(`SourceMap: invalid side='${String(side)}'`);
      return canon.toOriginalPos(pos, side);
    },
  };
}

// Границы токенов: словесный край литерала не должен продолжаться словесным символом
// канона (int x ≠ intx), а '{k', ';x' — разные токены, границу требовать не надо.
function boundaryOk(text: string, norm: string, pos: number): boolean {
  const n = norm.length;
  if (n === 0) return true;
  if (isWordChar(norm[0]!) && pos > 0 && isWordChar(text[pos - 1]!)) return false;
  const right = pos + n;
  if (isWordChar(norm[n - 1]!) && right < text.length && isWordChar(text[right]!)) return false;
  return true;
}
