import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { ProgressMessage, RequestMessage, ResponseMessage } from './protocol.ts';
import { handle } from './handler.ts';
import { invokedDirectly } from '../infra/entry.ts';

export async function serve(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  let flushed = true;
  const send = (message: ResponseMessage | ProgressMessage): void => {
    flushed = output.write(`${JSON.stringify(message)}\n`);
  };
  const drain = async (): Promise<void> => {
    if (!flushed) {
      await once(output, 'drain');
      flushed = true;
    }
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
      await drain();
      continue;
    }

    send(await handle(request, send));
    await drain();
  }
}

if (invokedDirectly(import.meta.url)) {
  await serve();
}
