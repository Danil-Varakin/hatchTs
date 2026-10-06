// How much context a synthesized hunk may carry. Apart from synth.ts on purpose: the
// config reads these defaults on every `config` and `pair` request, and has no business
// loading the synthesizer and the matcher to do it.

export interface SynthLimits {
  readonly minParents: number;
  readonly maxParents: number | 'all';
  readonly parentDetailBase: number;
  readonly minSiblings: number;
  readonly maxSiblings: number;
  readonly siblingDetailBase: number;
  readonly parentsRequired: boolean;
}

export const DEFAULT_SYNTH_LIMITS: SynthLimits = {
  minParents: 1,
  maxParents: 'all',
  parentDetailBase: 0,
  minSiblings: 0,
  maxSiblings: 8,
  siblingDetailBase: 0,
  parentsRequired: false,
};

export type PartialLimits = { [K in keyof SynthLimits]?: SynthLimits[K] | undefined };

export function resolveLimits(patch: PartialLimits | undefined): SynthLimits {
  const out = { ...DEFAULT_SYNTH_LIMITS };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return Object.freeze(out);
}
