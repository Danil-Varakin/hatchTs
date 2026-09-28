import type { Ask } from '../infra/ask.ts';
import type { ArgSpec } from './args.ts';
import type { Answers } from './prompt.ts';

// Asking before a step that loses something, or reads a version nobody quite named.
// The question goes to a person when there is one at a terminal; `--yes` answers it in
// advance for scripts; and with nobody to ask the answer is NO — a run that cannot be
// watched must not be the one that quietly throws work away.

export interface ConfirmOptions {
  yes: boolean;
}

/** Spread into a command's ArgSpec. */
export const CONFIRM_ARGS = {
  flags: { '--yes': 'yes', '-y': 'yes' },
} as const satisfies ArgSpec<ConfirmOptions>;

export const CONFIRM_USAGE = `  --yes,    -y            answer yes in advance to every warning that asks before
                          going on. Without it the question goes to the terminal, and
                          where there is no terminal to answer (a pipe, CI) the
                          answer is no and the run stops`;

export interface AskerDeps {
  readonly yes: boolean;
  /** a person at a terminal, who can both see the question and answer it */
  readonly interactive: boolean;
  readonly note: (message: string) => void;
  /** the next answer, or null when the input closed first */
  readonly prompt: (text: string) => Promise<string | null>;
}

export function asker(deps: AskerDeps): Ask {
  return async (question) => {
    deps.note(`warning: ${question}`);
    if (deps.yes) {
      deps.note('  --yes: going ahead');
      return true;
    }
    if (!deps.interactive) {
      deps.note('  not a terminal, so nobody can answer: stopping (pass --yes to go ahead)');
      return false;
    }
    // A closed input is no answer, and no answer to a question that loses work is no.
    const answer = await deps.prompt('  go ahead? [y/N] ');
    return answer !== null && /^\s*y(es)?\s*$/i.test(answer);
  };
}

/** The asker a command run from a shell gets. Both ends must be a terminal: a question
 *  written into a redirected stderr would be answered blind. */
export function terminalAsker(yes: boolean, note: (message: string) => void, answers: Answers): Ask {
  return asker({
    yes,
    interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    note,
    prompt: (text) => answers.next(text),
  });
}
