import { printPattern } from '../core/hatch-printer.ts';
import type { Hunk } from '../core/ast.ts';
import { InputClosed } from '../infra/ask.ts';
import type { Ask } from '../infra/ask.ts';

export function describeHunk(h: Hunk, index: number, total: number): string {
  return `hunk ${index + 1}/${total}:\n--- match ---\n${printPattern(h.match)}\n--- patch ---\n${h.patch}`;
}

/** Keeps the hunks `ask` says yes to. An input that closes before the last answer ends
 *  the review with nothing kept and nothing guessed: the error names how far it got. */
export async function reviewHunks(hunks: readonly Hunk[], ask: Ask): Promise<Hunk[]> {
  const kept: Hunk[] = [];
  for (const [i, h] of hunks.entries()) {
    let keep: boolean;
    try {
      keep = await ask(describeHunk(h, i, hunks.length));
    } catch (e) {
      if (!(e instanceof InputClosed)) throw e;
      throw new Error(
        `-a: the input closed at hunk ${i + 1} of ${hunks.length}, before it was answered — ` +
          'nothing was written\n  answer every hunk (one line each, Enter keeps it), or drop -a',
      );
    }
    if (keep) kept.push(h);
  }
  return kept;
}
