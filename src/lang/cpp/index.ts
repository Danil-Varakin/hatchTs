// lang/cpp/index.ts — АДАПТЕР C++ одним файлом. Вся плумбинг-логика (загрузка
// грамматики, parse, канон, обход дерева, сборка карты) — в общих
// lang/{make-adapter,block-spans,canon,build-map,treesitter}. Здесь РОВНО правила
// языка C++ — ровно то, что меняется от языка к языку:
//   • grammar / extensions — какой .wasm и какие расширения файлов;
//   • normalize            — канон литерала (что незначащий пробел);
//   • cppBlockOf           — маркер вложенности (что считать блоком).
// Чтобы добавить язык — скопируй этот файл и замени три пункта (см. docs/adapter-layer.md).
import { join } from 'node:path';

import { makeAdapter } from '../make-adapter.ts';
import { isWordChar } from '../word.ts';
import type { Node } from '../treesitter.ts';
import type { BlockOf, OrigSpan } from '../block-spans.ts';

// ── Канонизация C++ (годится для С-подобных) ────────────────────────────────
// Пробел значим ТОЛЬКО между двумя словесными символами [\p{L}\p{N}_] — там
// схлопывается в один; всё остальное (вокруг пунктуации, переносы строк, ведущий
// отступ) выкидывается. Один проход без sentinel-символа: настоящий U+0000 во
// входе непробельный, проходит насквозь и не рвёт выравнивание канона.
export function normalize(raw: string): string {
  return raw.replace(/\s+/g, (ws, off: number) =>
    off > 0 && isWordChar(raw[off - 1]!) && isWordChar(raw[off + ws.length] ?? '')
      ? ' '
      : '',
  );
}

// ── Маркер вложенности C++ ──────────────────────────────────────────────────
// Блок = именованный узел, чей ПЕРВЫЙ дочерний токен — открывающая скобка, а
// ПОСЛЕДНИЙ — её пара. Одним правилом ловит {} (тела, классы, namespace, enum,
// initializer), () (аргументы, параметры), [] (индекс), <> (шаблоны). На УЗЛАХ,
// поэтому 'a < b' (оператор «меньше») блоком НЕ станет.
//
// Map, а не объектный литерал: у литерала есть Object.prototype, поэтому
// obj['constructor']/['toString']/['__proto__'] вернули бы унаследованную функцию
// вместо undefined. Map честно отдаёт undefined на любой чужой ключ — фильтр
// «не-блоков» становится гарантией, а не «счастливой случайностью».
const PAIR = new Map<string, string>([
  ['{', '}'],
  ['(', ')'],
  ['[', ']'],
  ['<', '>'],
]);

const cppBlockOf: BlockOf = (node: Node): OrigSpan | null => {
  if (!node.isNamed) return null;
  const first = node.firstChild;
  if (first === null) return null;
  const wantClose = PAIR.get(first.type);
  if (wantClose === undefined) return null;
  const last = node.lastChild;
  if (last === null || last.type !== wantClose) return null;
  return { open: first.startIndex, close: last.startIndex };
};

// ── Сборка адаптера: четыре правила → общий конструктор ─────────────────────
export const cppAdapter = makeAdapter({
  grammarPath: join(import.meta.dirname, '../../../grammars/tree-sitter-cpp.wasm'),
  extensions: ['.cc', '.cpp', '.cxx', '.h', '.hpp', '.inc'], // .h в Chromium = C++
  normalize,
  blockOf: cppBlockOf,
});
