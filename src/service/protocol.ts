import type { HunkLink } from '../core/resolve.ts';
import type { PartialLimits } from '../generate/synth.ts';
import type { GenerateSettings } from '../infra/config/index.ts';

export type { HunkLink, LinkFailure, LinkStatus, ResolveResult, Span } from '../core/resolve.ts';
export type { PartialLimits, SynthLimits } from '../generate/synth.ts';
export type { GenerateSettings } from '../infra/config/index.ts';

export const PROTOCOL_VERSION = 2;

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

/** The OLD version NAMED instead of sent: the same three coordinates the CLI takes,
 *  each one optional, what is missing taking its default — the branch we are on, its
 *  last commit, the path of `params.path` inside the repository. All three left out
 *  (`baseGit: {}`) is "this same file, as of the last commit here".
 *
 *  Needs `params.path`: the repository is found from it, and it supplies the default
 *  path inside that repository. */
export interface GitSourceParams {
  readonly branch?: string;
  readonly commit?: string;
  readonly repoPath?: string;
}

export interface GenerateParams extends LanguageParams {
  /** The old version as text. Exactly one of `baseText` and `baseGit`. */
  readonly baseText?: string;
  readonly baseGit?: GitSourceParams;
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
  /** `<revision>:<path>` when the base came out of git, null when it was sent as text. */
  readonly baseSpec: string | null;
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
