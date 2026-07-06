// lang/canon.ts — ОБЩИЙ: канон исходника + точечный перевод координат канон↔оригинал.
// Опора (00-general-rules §2): normalize трогает ТОЛЬКО пробелы, значит
// подпоследовательность непробельных символов в оригинале и каноне тождественна.
// Выравниваемся по ней; перевод в обе стороны — бинарным поиском по этим позициям.

export interface Canon {
  text: string;
  toCanonPos(origPos: number): number;
  toOriginalPos(canonPos: number, side: 'left' | 'right'): number;
}

export function buildCanon(
  source: string,
  canonicalize: (s: string) => string,
): Canon {
  const text = canonicalize(source);
  const origAt = nonWsIndices(source);
  const canonAt = nonWsIndices(text);
  const nonWsCount = origAt.length;

  if (nonWsCount !== canonAt.length) {
    throw new Error(
      `canon: рассинхрон непробельных (${nonWsCount} в оригинале, ${canonAt.length} в каноне) — normalize тронул НЕ только пробелы`,
    );
  }

  return {
    text,
    toCanonPos(origPos: number): number {
      const rank = lowerBound(origAt, origPos);
      return rank < nonWsCount ? canonAt[rank]! : text.length;
    },
    toOriginalPos(canonPos: number, side: 'left' | 'right'): number {
      const cnt = lowerBound(canonAt, canonPos);
      if (side === 'left') return cnt === 0 ? 0 : origAt[cnt - 1]! + 1;
      return cnt < nonWsCount ? origAt[cnt]! : source.length;
    },
  };
}

function nonWsIndices(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!isSpace(s.charCodeAt(i))) out.push(i);
  }
  return out;
}

// Первый индекс i, где arr[i] >= x (= количество элементов строго меньше x).
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Совпадает с семантикой JS-регэкспа \s (тем, что схлопывает normalize).
function isSpace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}
