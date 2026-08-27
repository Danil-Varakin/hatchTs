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

// ── сборка .md текущего формата: жёлоб в четыре пробела + '# end' ─────────────

export function gutter(line: string): string {
  return line === '' ? '' : '    ' + line;
}

export function block(heading: string, body: string): string[] {
  return [heading, ...(body === '' ? [] : body.split('\n').map(gutter)), '# end'];
}

export interface HunkSpec {
  match: string;
  patch?: string;
}

export function hatchMd(hunks: readonly HunkSpec[], lang: string | undefined = 'cpp'): string {
  const heading = lang === undefined ? '# match' : `# match ${lang}`;
  return (
    hunks
      .map((h) => [...block(heading, h.match), ...block('# patch', h.patch ?? 'X')].join('\n'))
      .join('\n\n') + '\n'
  );
}

export function wrapMatch(body: string, lang = 'cpp'): string {
  return hatchMd([{ match: body }], lang);
}

export function roundtrip(m: MatchPattern, lang = 'cpp'): MatchPattern {
  return firstMatch(wrapMatch(printPattern(m), lang));
}
