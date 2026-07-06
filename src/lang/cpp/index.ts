// lang/cpp/index.ts — CppAdapter: склейка общих lang/{treesitter,canon,build-map}
// с C++-знанием cpp/{normalize,blocks}. C++-специфики тут ровно два куска.
import { join } from 'node:path';

import { loadGrammar, parse } from '../treesitter.ts';
import type { Language } from '../treesitter.ts';
import { buildCanon } from '../canon.ts';
import { makeSourceMap } from '../build-map.ts';
import type { SourceMap, LanguageAdapter } from '../source-map.ts';
import { normalize } from './normalize.ts';
import { cppBlockSpans } from './blocks.ts';

const GRAMMAR = join(import.meta.dirname, '../../../grammars/tree-sitter-cpp.wasm');

let grammar: Language | null = null;

export const cppAdapter: LanguageAdapter = {
  extensions: ['.cc', '.cpp', '.cxx', '.h', '.hpp', '.inc'], // .h в Chromium = C++

  normalize,

  async init(): Promise<void> {
    grammar = await loadGrammar(GRAMMAR);
  },

  buildMap(source: string): SourceMap {
    if (grammar === null) throw new Error('cppAdapter: init() не вызван перед buildMap');
    const tree = parse(grammar, source);
    try {
      const canon = buildCanon(source, normalize);
      const spans = cppBlockSpans(tree, canon.toCanonPos);
      return makeSourceMap(canon, spans);
    } finally {
      tree.delete();
    }
  },
};
