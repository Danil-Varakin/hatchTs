// lang/build-map.ts — ОБЩИЙ: собирает SourceMap из канона + пролётов блоков.
// Всё в КАНОНИЧЕСКИХ координатах; в оригинал переводит только toOriginalPos (через canon).
import type { Canon } from './canon.ts';
import type { SourceMap } from './source-map.ts';

export interface BlockSpan {
  open: number; // канон-позиция '{'
  close: number; // канон-позиция '}'
}

export function makeSourceMap(canon: Canon, spans: readonly BlockSpan[]): SourceMap {
  const text = canon.text;
  const eof = text.length;

  return {
    eof,

    matchesAt(norm: string, pos: number): boolean {
      return text.startsWith(norm, pos) && boundaryOk(text, norm, pos);
    },

    occurrences(norm: string, from: number, to: number): number[] {
      const out: number[] = [];
      if (norm === '') return out;
      for (let p = text.indexOf(norm, from); p !== -1 && p < to; p = text.indexOf(norm, p + 1)) {
        if (boundaryOk(text, norm, p)) out.push(p);
      }
      return out;
    },

    // Конец (позиция '}') самого ВНУТРЕННЕГО блока, объемлющего pos. Нет → eof.
    enclosingEnd(pos: number): number {
      let bestOpen = -1;
      let end = eof;
      for (const s of spans) {
        if (s.open < pos && pos <= s.close && s.open > bestOpen) {
          bestOpen = s.open;
          end = s.close;
        }
      }
      return end;
    },

    depthAt(pos: number): number {
      let d = 0;
      for (const s of spans) if (s.open < pos && pos <= s.close) d++;
      return d;
    },

    // Позиции '{' объемлющих блоков, снаружи→внутрь (для synth).
    enclosing(pos: number): number[] {
      const opens: number[] = [];
      for (const s of spans) if (s.open < pos && pos <= s.close) opens.push(s.open);
      opens.sort((a, b) => a - b);
      return opens;
    },

    toOriginalPos(pos: number, side: 'left' | 'right'): number {
      return canon.toOriginalPos(pos, side);
    },
  };
}

// Границы токенов: если краевой символ литерала словесный — соседний в каноне не должен быть.
function boundaryOk(text: string, norm: string, pos: number): boolean {
  const n = norm.length;
  if (n === 0) return true;
  if (isWord(norm.charCodeAt(0)) && pos > 0 && isWord(text.charCodeAt(pos - 1))) return false;
  const right = pos + n;
  if (isWord(norm.charCodeAt(n - 1)) && right < text.length && isWord(text.charCodeAt(right))) {
    return false;
  }
  return true;
}

function isWord(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}
