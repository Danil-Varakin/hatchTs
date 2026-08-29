import type { HunkLink } from '../core/resolve.ts';
import type { PartialLimits } from '../generate/synth.ts';
import type { GenerateSettings } from '../infra/config/index.ts';

export type { HunkLink, LinkFailure, LinkStatus, ResolveResult, Span } from '../core/resolve.ts';
export type { PartialLimits, SynthLimits } from '../generate/synth.ts';
export type { GenerateSettings } from '../infra/config/index.ts';

export const PROTOCOL_VERSION = 1;

export interface RequestMessage {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

export interface ServiceError {
  readonly kind: string;
  readonly message: string;
  readonly exitCode: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ResponseMessage =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: ServiceError };

export interface ProgressMessage {
  readonly method: 'progress';
  readonly params: { readonly id: number; readonly done: number; readonly total: number };
}

// ── params ───────────────────────────────────────────────────────────────────────

export interface LanguageParams {
  readonly language?: string;
  readonly path?: string;
  readonly allowDownload?: boolean;
}

export interface GenerateParams extends LanguageParams {
  readonly baseText: string;
  readonly newText: string;
  readonly exact?: boolean;
  readonly bridgeGap?: number;
  readonly limits?: PartialLimits;
  readonly out?: string;
  readonly mirror?: boolean;
}

export interface ResolveParams extends LanguageParams {
  readonly md: string;
  readonly baseText: string;
}

export type ApplyParams = ResolveParams;

// ── results ──────────────────────────────────────────────────────────────────────

export interface VersionResult {
  readonly hatch: string;
  readonly protocol: number;
  readonly configSchema: number;
  readonly languages: readonly string[];
}

export interface AppliedConfig {
  readonly file: string | null;
  readonly settings: GenerateSettings;
  readonly origins: Readonly<Record<string, string>>;
}

export interface GenerateResult {
  readonly md: string;
  readonly language: string | undefined;
  readonly warnings: readonly string[];
  readonly hunks: readonly HunkLink[];
  readonly reproducesNew: boolean;
  readonly outPath: string | null;
  readonly config: AppliedConfig;
}

export interface ResolveResultMessage {
  readonly hunks: readonly HunkLink[];
}

export interface ApplyResultMessage {
  readonly text: string;
  readonly hunks: readonly HunkLink[];
}
