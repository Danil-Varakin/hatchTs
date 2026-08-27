import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export function writeFileAtomic(path: string, data: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.hatch-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, path); 
  } catch (e) {
    try {
      rmSync(tmp, { force: true }); 
    } catch {
    }
    throw e;
  }
}
