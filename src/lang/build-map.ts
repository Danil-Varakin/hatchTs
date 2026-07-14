// lang/build-map.ts — ОБЩИЙ: собирает SourceMap из канона + пролётов блоков.
// Всё в КАНОНИЧЕСКИХ координатах; в оригинал переводит только toOriginalPos (через canon).
// Кривой вход (pos вне [0,eof], пустой литерал, from>to) — баг вызывающего: бросаем.
//
// Пролёты приходят из узлов ОДНОГО дерева tree-sitter, поэтому строго вложены
// (пересечений нет). На этом стоит индексация: отсортированные границы + лес
// вложенности, запросы за O(log n) вместо линейного прохода по всем пролётам —
// карту дёргают на каждый кандидат '...', на файлах Chromium это существенно.
import type { Canon } from './canon.ts';
import type { SourceMap } from './source-map.ts';
import { isWordChar } from './word.ts';

export interface BlockSpan {
  open: number; // канон-позиция открывающей скобки
  close: number; // канон-позиция парной закрывающей
}

// Узел леса вложенности; children отсортированы по open (порядок построения).
interface SpanNode {
  open: number;
  close: number;
  children: SpanNode[];
}

export function makeSourceMap(canon: Canon, spans: readonly BlockSpan[]): SourceMap {
  const text = canon.text;
  const eof = text.length;

  // «внутри блока» = зазор в (open, close]: курсор вошёл, ПРОЙДЯ '{', и остаётся
  // до '}'. Глубина меняется ПОСЛЕ прохода скобки — отсюда строгий '<' по open и
  // нестрогий '<=' по close во всех формулах ниже.
  const sortedByOpen = [...spans].sort((a, b) => a.open - b.open);
  const opensAsc = sortedByOpen.map((s) => s.open);
  const closesAsc = spans.map((s) => s.close).sort((a, b) => a - b);
  const roots = buildForest(sortedByOpen);

  const assertPos = (pos: number, name: string): void => {
    if (!Number.isInteger(pos) || pos < 0 || pos > eof) {
      throw new RangeError(`SourceMap: ${name}=${pos} вне [0, ${eof}]`);
    }
  };
  const assertNorm = (norm: string): void => {
    if (norm.length === 0) throw new Error('SourceMap: пустой литерал');
  };

  // Объемлющие pos пролёты = начались до pos (open < pos) и не закрылись строго
  // до него (close >= pos). При строгой вложенности их ровно разность счётчиков.
  const depthOf = (pos: number): number =>
    lowerBound(opensAsc, pos) - lowerBound(closesAsc, pos);

  // Спуск по лесу: на каждом уровне — последний ребёнок с open < pos. Соседи не
  // пересекаются, поэтому если ОН не содержит pos, не содержит никто на уровне.
  // Даёт цепочку объемлющих снаружи внутрь за O(глубина · log ширина).
  const descend = (pos: number, visit: (n: SpanNode) => void): void => {
    let list = roots;
    for (;;) {
      const cand = lastOpenBefore(list, pos);
      if (cand === null || pos > cand.close) return;
      visit(cand);
      list = cand.children;
    }
  };

  return {
    eof,

    matchesAt(norm: string, pos: number): boolean {
      assertNorm(norm);
      assertPos(pos, 'pos');
      return text.startsWith(norm, pos) && boundaryOk(text, norm, pos);
    },

    // Вхождения на ТОЙ ЖЕ глубине, что from (сбалансированный пропуск для '...'),
    // целиком в окне [from, to). Вложенные (более глубокие) — отсеиваются.
    occurrences(norm: string, from: number, to: number): number[] {
      assertNorm(norm);
      assertPos(from, 'from');
      assertPos(to, 'to');
      if (from > to) throw new RangeError(`SourceMap: from=${from} > to=${to}`);
      const out: number[] = [];
      const len = norm.length;
      const fromDepth = depthOf(from);
      for (let p = text.indexOf(norm, from); p !== -1 && p + len <= to; p = text.indexOf(norm, p + 1)) {
        if (boundaryOk(text, norm, p) && depthOf(p) === fromDepth) out.push(p);
      }
      return out;
    },

    enclosingEnd(pos: number): number {
      assertPos(pos, 'pos');
      let end = eof;
      descend(pos, (n) => {
        end = n.close;
      });
      return end;
    },

    depthAt(pos: number): number {
      assertPos(pos, 'pos');
      return depthOf(pos);
    },

    enclosing(pos: number): number[] {
      assertPos(pos, 'pos');
      const opens: number[] = [];
      descend(pos, (n) => {
        opens.push(n.open);
      });
      return opens; // снаружи внутрь (open по возрастанию) — как и раньше
    },

    toOriginalPos(pos: number, side: 'left' | 'right'): number {
      assertPos(pos, 'pos');
      if (side !== 'left' && side !== 'right') throw new Error(`SourceMap: side='${String(side)}'`);
      return canon.toOriginalPos(pos, side);
    },
  };
}

// Лес вложенности из пролётов, отсортированных по open. Стек — цепочка ещё не
// закрытых предков: верхушка с close < s.open осталась позади текущего пролёта.
function buildForest(sortedByOpen: readonly BlockSpan[]): SpanNode[] {
  const roots: SpanNode[] = [];
  const stack: SpanNode[] = [];
  for (const s of sortedByOpen) {
    const node: SpanNode = { open: s.open, close: s.close, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.close < s.open) stack.pop();
    const top = stack[stack.length - 1];
    (top !== undefined && s.open < top.close ? top.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

// Последний узел списка с open < pos (список отсортирован по open), либо null.
function lastOpenBefore(list: readonly SpanNode[], pos: number): SpanNode | null {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]!.open < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? list[lo - 1]! : null;
}

// Число элементов отсортированного массива, СТРОГО меньших x.
function lowerBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
