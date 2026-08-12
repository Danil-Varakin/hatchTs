// Python canon: leading indentation is KEPT as the level marker, the rest of the line
// follows the C-like rule. Line by line; '\n' is significant.
import { isWordChar } from '../word.ts';

export function normalize(raw: string): string {
  return raw.split('\n').map(normalizeLine).join('\n');
}

function normalizeLine(line: string): string {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  const body = line.slice(indent.length);
  return (
    indent +
    body.replace(/\s+/g, (ws, off: number) =>
      off > 0 && isWordChar(body[off - 1]!) && isWordChar(body[off + ws.length] ?? '')
        ? ' '
        : '',
    )
  );
}
