import type { MatchPattern } from '../src/core/ast.ts';
import { parseHatchFile } from '../src/core/hatch-parser.ts';
import { printPattern } from '../src/core/hatch-printer.ts';

export interface FlatAnchor {
  kind: 'literal' | 'eof';
  raw?: string;
}
export interface FlatStep {
  mode: MatchPattern['steps'][number]['gap']['mode'];
  insert: 'left' | 'right' | null;
  replaceEnd: 'left' | 'right' | null;
  anchor: FlatAnchor;
}

export function strip(p: MatchPattern): FlatStep[] {
  return p.steps.map((s) => {
    const anchor: FlatAnchor =
      s.anchor.target === 'literal'
        ? { kind: 'literal', raw: s.anchor.literal.raw }
        : { kind: 'eof' };
    return {
      mode: s.gap.mode,
      insert: s.gap.insert?.side ?? null,
      replaceEnd: s.gap.replaceEnd?.side ?? null,
      anchor,
    };
  });
}

export function firstMatch(md: string): MatchPattern {
  return parseHatchFile(md).hunks[0]!.match;
}

export function wrapMatch(body: string, lang = 'cpp'): string {
  return ['# match', '```' + lang, body, '```', '# patch', '```', 'X', '```'].join(
    '\n',
  );
}

export function roundtrip(m: MatchPattern, lang = 'cpp'): MatchPattern {
  return firstMatch(wrapMatch(printPattern(m), lang));
}
