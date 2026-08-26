import { ConfigError } from '../../core/errors.ts';
import { DEFAULT_SYNTH_LIMITS } from '../../generate/synth.ts';
import type { SynthLimits } from '../../generate/synth.ts';

export const CONFIG_VERSION = 1;

export interface GenerateSettings extends SynthLimits {
  readonly out: string | null;
  readonly language: string | null;
  readonly exact: boolean;
  readonly bridgeGap: number;
}

export type PartialSettings = { [K in keyof GenerateSettings]?: GenerateSettings[K] | undefined };

type ValueKind = 'boolean' | 'count' | 'countOrAll' | 'stringOrNull';

export interface FieldSpec {
  readonly path: string;
  readonly key: keyof GenerateSettings;
  readonly kind: ValueKind;
  readonly flag: string;
}

export const FIELDS: readonly FieldSpec[] = [
  { path: 'generate.out', key: 'out', kind: 'stringOrNull', flag: '--out' },
  { path: 'generate.language', key: 'language', kind: 'stringOrNull', flag: '--language' },
  { path: 'generate.exact', key: 'exact', kind: 'boolean', flag: '--exact' },
  { path: 'generate.bridgeGap', key: 'bridgeGap', kind: 'count', flag: '--bridge-gap' },
  { path: 'generate.parents.min', key: 'minParents', kind: 'count', flag: '--min-parents' },
  { path: 'generate.parents.max', key: 'maxParents', kind: 'countOrAll', flag: '--parents' },
  { path: 'generate.parents.detail.base', key: 'parentDetailBase', kind: 'count', flag: '--parent-detail' },
  { path: 'generate.parents.required', key: 'parentsRequired', kind: 'boolean', flag: '--require-parents' },
  { path: 'generate.siblings.min', key: 'minSiblings', kind: 'count', flag: '--min-siblings' },
  { path: 'generate.siblings.max', key: 'maxSiblings', kind: 'count', flag: '--siblings' },
  { path: 'generate.siblings.detail.base', key: 'siblingDetailBase', kind: 'count', flag: '--sibling-detail' },
];

export const DEFAULT_SETTINGS: GenerateSettings = Object.freeze({
  ...DEFAULT_SYNTH_LIMITS,
  out: null,
  language: null,
  exact: false,
  bridgeGap: 0,
});

export const GROUP_PATHS = new Set(
  FIELDS.flatMap((f) => {
    const parts = f.path.split('.');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'));
  }),
);

export const FIELD_BY_PATH = new Map(FIELDS.map((f) => [f.path, f]));
export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function knownConfigKeys(): string[] {
  return FIELDS.map((f) => f.path);
}

export function checkValue(value: unknown, spec: FieldSpec, file: string | undefined): unknown {
  const bad = (expected: string): never => {
    throw new ConfigError(`"${spec.path}" must be ${expected} (got ${JSON.stringify(value) ?? 'undefined'})`, file);
  };
  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : bad('true or false');
    case 'count':
      return isCount(value) ? value : bad('a non-negative integer');
    case 'countOrAll':
      return value === 'all' || isCount(value) ? value : bad('a non-negative integer or "all"');
    case 'stringOrNull':
      if (value === null) return null;
      return typeof value === 'string' && value.trim() !== '' ? value : bad('a non-empty string or null');
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000;
}

/**
 * Cross-field checks. There are none left: the pair that lived here compared
 * `detail.base` against a `detail.limit`, and the ceiling is gone — unfolding is
 * adaptive and stops when no bracket can tell the candidates apart, so there is nothing
 * left to contradict. Kept as the seam, because the next contradictory pair will want
 * exactly this shape and the same "name the origin of BOTH values" wording.
 */
export function checkPairs(_settings: GenerateSettings, _origins: Record<string, string>): void {
  // no contradictory pairs today
}
