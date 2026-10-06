import { GRAMMARS_SHIP_INSIDE } from './deprecated.ts';

// `hatch grammars` fetched the grammars into a user cache until 0.3. They ship inside
// hatch now (infra/grammar-store.ts); the command stays for 0.4 only, says so and
// succeeds, so a script that runs it keeps working (VERSIONING.md F2). Removed in 0.5.

export function main(_argv: readonly string[]): Promise<void> {
  process.stderr.write(`warning: ${GRAMMARS_SHIP_INSIDE}\n`);
  return Promise.resolve();
}
