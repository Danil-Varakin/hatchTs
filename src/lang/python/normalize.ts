// lang/python/normalize.ts — канон Python: ведущий отступ строки СОХРАНЯЕТСЯ
// (маркер уровня вложенности), тело строки чистится тем же правилом, что C-подобные:
// пробел значим только между словесными символами. Построчно; '\n' значим.
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
