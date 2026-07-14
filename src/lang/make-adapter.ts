// lang/make-adapter.ts — ОБЩИЙ конструктор адаптера. Всё, что НЕ зависит от языка
// (загрузка грамматики, parse, канон, обход дерева, сборка карты, кеш grammar,
// проверки init/типа) живёт здесь ОДИН раз. Язык приносит РОВНО четыре правила:
// грамматику, расширения, normalize (канонизация), blockOf (вложенность).
import { loadGrammar, parse } from './treesitter.ts';
import type { Language } from './treesitter.ts';
import { buildCanon } from './canon.ts';
import { makeSourceMap } from './build-map.ts';
import { collectBlockSpans } from './block-spans.ts';
import type { BlockOf } from './block-spans.ts';
import type { SourceMap, LanguageAdapter } from './source-map.ts';

export interface LanguageRules {
  grammarPath: string; // абсолютный путь к tree-sitter-*.wasm
  extensions: readonly string[]; // для автоопределения языка по имени файла
  normalize: (raw: string) => string; // канон литерала/исходника по правилам языка
  blockOf: BlockOf; // правило вложенности: узел → пролёт блока | null
}

export function makeAdapter(rules: LanguageRules): LanguageAdapter {
  let grammar: Language | null = null;

  return {
    extensions: rules.extensions,
    normalize: rules.normalize,

    async init(): Promise<void> {
      grammar = await loadGrammar(rules.grammarPath);
    },

    buildMap(source: string): SourceMap {
      if (grammar === null) throw new Error('adapter: init() was not called before buildMap');
      if (typeof source !== 'string') throw new TypeError('adapter.buildMap: source is not a string');
      const tree = parse(grammar, source);
      try {
        const canon = buildCanon(source, rules.normalize);
        const spans = collectBlockSpans(tree, canon.toCanonPos, rules.blockOf);
        return makeSourceMap(canon, spans);
      } finally {
        tree.delete();
      }
    },
  };
}
