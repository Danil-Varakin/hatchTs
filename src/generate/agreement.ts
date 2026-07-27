// generate/agreement.ts — режим `-a`: показать каждый синтезированный ханк и спросить,
// оставлять ли его. Чистое ядро (принимает функцию confirm) — тестируется без stdin;
// интерактивную реализацию confirm даёт cli/generate.
import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';

/** Спросить пользователя да/нет по тексту-описанию ханка. */
export type Confirm = (question: string) => Promise<boolean>;

/** Человекочитаемое описание ханка для подтверждения. */
export function describeHunk(h: Hunk, index: number, total: number): string {
  return `hunk ${index + 1}/${total}:\n--- match ---\n${printPattern(h.match)}\n--- patch ---\n${h.patch}`;
}

/** Оставить только подтверждённые ханки (порядок сохраняется). */
export async function reviewHunks(hunks: readonly Hunk[], confirm: Confirm): Promise<Hunk[]> {
  const kept: Hunk[] = [];
  for (const [i, h] of hunks.entries()) {
    if (await confirm(describeHunk(h, i, hunks.length))) kept.push(h);
  }
  return kept;
}
