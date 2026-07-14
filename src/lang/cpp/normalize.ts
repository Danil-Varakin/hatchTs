// lang/cpp/normalize.ts — канон литерала C++: пробел значим ТОЛЬКО между двумя
// словесными символами (схлопывается в один); всё остальное — вокруг пунктуации,
// переносы строк, ведущий отступ — выкидывается.
// Один проход без sentinel-символа: настоящий U+0000 во входе — непробельный,
// проходит насквозь как есть и не рвёт выравнивание канона.
import { isWordChar } from '../word.ts';

export function normalize(raw: string): string {
  return raw.replace(/\s+/g, (ws, off: number) =>
    off > 0 && isWordChar(raw[off - 1]!) && isWordChar(raw[off + ws.length] ?? '')
      ? ' '
      : '',
  );
}
