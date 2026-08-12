import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ConfigError } from '../../core/errors.ts';
import {
  DEFAULT_SETTINGS,
  FIELDS,
  FIELD_BY_KEY,
  FIELD_BY_PATH,
  GROUP_PATHS,
  checkPairs,
  checkValue,
  knownConfigKeys,
} from './schema.ts';
import type { GenerateSettings, PartialSettings } from './schema.ts';
import { CONFIG_VERSION } from './schema.ts';

export const CONFIG_FILE_NAME = 'hatch.config.json';

export interface ResolvedConfig {
  readonly version: number;
  readonly generate: GenerateSettings;
  readonly file: string | undefined;
  readonly origins: Readonly<Record<string, string>>;
}

export interface FlagOverride {
  readonly key: keyof GenerateSettings;
  readonly value: unknown;
  readonly flag: string;
}

export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (isFile(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function readConfigFile(file: string): PartialSettings {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new ConfigError(`cannot read config: ${(e as Error).message}`, file);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`invalid JSON: ${(e as Error).message}`, file);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError('config must be a JSON object', file);
  }

  const out: PartialSettings = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '$schema') continue;
    if (key === 'version') {
      if (value !== CONFIG_VERSION) {
        throw new ConfigError(`"version" must be ${CONFIG_VERSION} (got ${JSON.stringify(value)})`, file);
      }
      continue;
    }
    collect(value, key, out, file);
  }
  return out;
}

function collect(node: unknown, path: string, out: PartialSettings, file: string): void {
  const spec = FIELD_BY_PATH.get(path);
  if (spec !== undefined) {
    Object.assign(out, { [spec.key]: checkValue(node, spec, file) });
    return;
  }
  if (!GROUP_PATHS.has(path)) {
    throw new ConfigError(`unknown key "${path}"\n  known keys: ${knownConfigKeys().join(', ')}`, file);
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new ConfigError(`"${path}" must be an object`, file);
  }
  for (const [key, value] of Object.entries(node)) collect(value, `${path}.${key}`, out, file);
}

export function resolveConfig(options: {
  file?: string | undefined;
  fromFile?: PartialSettings | undefined;
  flags?: readonly FlagOverride[] | undefined;
}): ResolvedConfig {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  const origins: Record<string, string> = {};
  for (const spec of FIELDS) origins[spec.path] = 'default';

  const fileOrigin = options.file !== undefined ? `config ${options.file}` : 'config';

  
  for (const [key, value] of Object.entries(options.fromFile ?? {})) {
    if (value === undefined) continue;
    const spec = FIELD_BY_KEY.get(key as keyof GenerateSettings);
    if (spec === undefined) continue;
    settings[key] = value;
    origins[spec.path] = fileOrigin;
  }

  for (const override of options.flags ?? []) {
    if (override.value === undefined) continue;
    const spec = FIELD_BY_KEY.get(override.key);
    if (spec === undefined) throw new ConfigError(`internal: no config field for flag ${override.flag}`);
    settings[override.key] = checkValue(override.value, spec, undefined);
    origins[spec.path] = `flag ${override.flag}`;
  }

  checkPairs(settings as unknown as GenerateSettings, origins);

  return Object.freeze({
    version: CONFIG_VERSION,
    generate: Object.freeze(settings) as unknown as GenerateSettings,
    file: options.file,
    origins: Object.freeze(origins),
  });
}

export function loadConfig(options: {
  explicitPath?: string | undefined;
  startDir: string;
  useFile: boolean;
  flags?: readonly FlagOverride[] | undefined;
}): ResolvedConfig {
  const flags = options.flags;
  if (!options.useFile) return resolveConfig({ flags });

  let file: string | undefined;
  if (options.explicitPath !== undefined) {
    file = isAbsolute(options.explicitPath) ? options.explicitPath : resolve(options.explicitPath);
    if (!isFile(file)) throw new ConfigError('no such config file', file);
  } else {
    file = findConfigFile(options.startDir);
  }
  if (file === undefined) return resolveConfig({ flags });
  return resolveConfig({ file, fromFile: readConfigFile(file), flags });
}

export function formatConfig(config: ResolvedConfig): string {
  const width = Math.max(...FIELDS.map((f) => f.path.length));
  const lines = [`version = ${config.version}`];
  for (const spec of FIELDS) {
    const value = JSON.stringify(config.generate[spec.key]);
    lines.push(`${spec.path.padEnd(width)} = ${value.padEnd(6)}  [${config.origins[spec.path]}]`);
  }
  return lines.join('\n') + '\n';
}
