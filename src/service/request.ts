import { isAbsolute } from 'node:path';
import type { RequestMessage } from './protocol.ts';

// Decoding a request: the shape of the line and the type of every param a method
// knows, checked before any of it is used. A param of the wrong type is the client's
// mistake and is answered as one — `BadRequest`, naming the param — never as whatever
// the code it reaches happens to throw. Values a config would check (`exact`,
// `bridgeGap`, `out`, the keys of `limits`) are left to the config's own checks: they
// answer `ConfigError`, the same as the file would. A param no method knows is read past.

export class BadRequest extends Error {}

export type ParamKind = 'string' | 'number' | 'boolean' | 'object';

/** The params a method takes, by name, with their type. */
export type ParamSpec = Readonly<Record<string, ParamKind>>;

/** A line that is not `{ id, method, params }` at all. */
export function requestShape(value: unknown): { readonly id: number; readonly message: RequestMessage | null } {
  if (!isObject(value)) return { id: 0, message: null };
  const id = typeof value['id'] === 'number' ? value['id'] : 0;
  return { id, message: value as unknown as RequestMessage };
}

export const NOT_A_REQUEST =
  'a request is a JSON object: { "id": <number>, "method": <string>, "params": { … } }';

/** `params` of `message`, each one this method knows of the type it takes. */
export function decode<T>(message: RequestMessage, spec: ParamSpec): T {
  const p = message.params;
  if (!isObject(p)) throw new BadRequest(`method '${message.method}' needs params`);
  checkTypes(p, spec, 'params');
  return p as T;
}

export function checkTypes(value: Readonly<Record<string, unknown>>, spec: ParamSpec, where: string): void {
  for (const [name, kind] of Object.entries(spec)) {
    const field = value[name];
    if (field === undefined || isKind(field, kind)) continue;
    throw new BadRequest(`${where}.${name} must be ${KIND_NAMES[kind]} (got ${describe(field)})`);
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A path the service can use: it is spawned by the client and has no meaningful current
 *  directory, so a relative one names nothing. */
export function absolutePath(path: string | undefined, name = 'params.path'): void {
  if (path !== undefined && !isAbsolute(path)) {
    throw new BadRequest(
      `${name} must be absolute (got '${path}'): the service is spawned by the client ` +
        'and has no meaningful current directory. Send an absolute path, or omit path and ' +
        'send params.language instead.',
    );
  }
}

const KIND_NAMES: Readonly<Record<ParamKind, string>> = {
  string: 'a string',
  number: 'a number',
  boolean: 'true or false',
  object: 'an object',
};

function isKind(value: unknown, kind: ParamKind): boolean {
  return kind === 'object' ? isObject(value) : typeof value === kind;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
