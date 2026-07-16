// infra/fs.ts — атомарная запись файла: temp в ТОЙ ЖЕ директории + rename.
// Инструмент правит исходники Chromium; оборванная запись (диск/сигнал) = сломанная
// сборка. rename на одной ФС атомарен: читатель видит либо старый файл, либо новый
// целиком, но НИКОГДА не полуфайл. Temp обязан быть на той же ФС (той же папке),
// иначе rename выродится в копирование и атомарность потеряется.
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/** Записать data в path атомарно (temp+rename). Бросает при ошибке ввода-вывода. */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.hatch-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, path); // атомарная подмена на одной ФС
  } catch (e) {
    try {
      rmSync(tmp, { force: true }); // прибрать temp, если rename не случился
    } catch {
      /* игнор: исходная ошибка важнее */
    }
    throw e;
  }
}
