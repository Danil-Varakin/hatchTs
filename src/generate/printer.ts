import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';

const GUTTER = '    ';

export function printHatchFile(hunks: readonly Hunk[], language?: string): string {
  const head = language !== undefined && language !== '' ? `# match ${language}` : '# match';
  return (
    hunks
      .map((h) =>
        [
          head,
          ...gutter(printPattern(h.match)),
          '# end',
          '# patch',
          ...gutter(h.patch),
          '# end',
        ].join('\n'),
      )
      .join('\n\n') + '\n'
  );
}

function gutter(text: string): string[] {
  if (text === '') return [];
  return text.split('\n').map((l) => (l === '' ? '' : GUTTER + l));
}

export function trailingSpaceWarnings(hunks: readonly Hunk[]): string[] {
  const out: string[] = [];
  for (const [i, h] of hunks.entries()) {
    const n = h.patch.split('\n').filter((l) => /[ \t]$/.test(l)).length;
    if (n > 0) {
      out.push(
        `hunk ${i + 1}: patch body has ${n} line(s) ending in whitespace — significant, ` +
          'do not run a trailing-whitespace fixer on this .md',
      );
    }
  }
  return out;
}
