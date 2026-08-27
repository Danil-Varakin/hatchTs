import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { ProgressMessage, RequestMessage, ResponseMessage } from './protocol.ts';
import { handle } from './handler.ts';

// hatch as a long-lived process: one JSON object per line in, one per line out.
//
// Why this exists next to the CLI, rather than a client shelling out to `hatch
// generate`: an editor holds an unsaved buffer (no file to pass), needs offsets rather
// than a printed .md, and asks often enough that reloading the tree-sitter grammar per
// call is the dominant cost. A process that stays up loads it once.
//
// Requests are served strictly in order. Synthesis is synchronous and holds the event
// loop, so a request cannot be cancelled from inside — a client cancels by killing the
// process, which costs one grammar load on the next start and nothing else.

export async function serve(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const send = (message: ResponseMessage | ProgressMessage): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  for await (const line of createInterface({ input })) {
    if (line.trim() === '') continue;

    let request: RequestMessage;
    try {
      request = JSON.parse(line) as RequestMessage;
    } catch (e) {
      send({
        id: 0,
        ok: false,
        error: { kind: 'BadRequest', message: `not JSON: ${(e as Error).message}`, exitCode: 1 },
      });
      continue;
    }

    send(await handle(request, send));
  }
}

function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    // realpath, not argv1 as given: the path can lead through a symlink (npm link,
    // a file: dependency, npm's bin shim), and then the comparison would not hold —
    // the service would exit quietly without ever starting to listen
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await serve();
}
