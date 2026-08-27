import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';

export type Confirm = (question: string) => Promise<boolean>;

export function describeHunk(h: Hunk, index: number, total: number): string {
  return `hunk ${index + 1}/${total}:\n--- match ---\n${printPattern(h.match)}\n--- patch ---\n${h.patch}`;
}

export async function reviewHunks(hunks: readonly Hunk[], confirm: Confirm): Promise<Hunk[]> {
  const kept: Hunk[] = [];
  for (const [i, h] of hunks.entries()) {
    if (await confirm(describeHunk(h, i, hunks.length))) kept.push(h);
  }
  return kept;
}
