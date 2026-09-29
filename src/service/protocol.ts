import type { HunkLink } from '../core/resolve.ts';
import type { PartialLimits } from '../generate/synth.ts';
import type { GenerateSettings } from '../infra/config/index.ts';

export type { HunkLink, LinkFailure, LinkStatus, ResolveResult, Span } from '../core/resolve.ts';
export type { PartialLimits, SynthLimits } from '../generate/synth.ts';
export type { GenerateSettings } from '../infra/config/index.ts';

// A RANGE, announced in `version`: this hatch speaks PROTOCOL_VERSION and still serves,
// unchanged, every client written for PROTOCOL_MIN or later. Every change to the wire
// raises PROTOCOL_VERSION (once per release); only a change an older client would trip
// over raises PROTOCOL_MIN with it. Rules: VERSIONING.md.
export const PROTOCOL_VERSION = 4;
export const PROTOCOL_MIN = 2;

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

/** The version a method works from — the OLD one for `generate`, the one to patch for
 *  `resolve`/`apply`. Sent as text or named in git: exactly one of the two. */
export interface BaseParams {
  readonly baseText?: string;
  readonly baseGit?: GitSourceParams;
}

export interface GenerateParams extends LanguageParams, BaseParams {
  readonly newText: string;
  readonly exact?: boolean;
  readonly bridgeGap?: number;
  readonly limits?: PartialLimits;
  readonly out?: string;
  readonly mirror?: boolean;
}

export interface ResolveParams extends LanguageParams, BaseParams {
  readonly md: string;
}

export type ApplyParams = ResolveParams;

/** The text of a new hatch.config.json. The service writes nothing: the client asks
 *  the user, writes the file and decides about overwriting. Protocol 4. */
export interface ConfigTemplateParams {
  /** absolute; the repository root is found from it */
  readonly path: string;
  /** the config schema to write, within `version().configSchemaMin..configSchema`;
   *  the newest when left out */
  readonly version?: number;
  /** initial values, in the paths of the config: `{ generate: { out: "patches/" } }` or
   *  `{ "generate.out": "patches/" }` */
  readonly settings?: Readonly<Record<string, unknown>>;
}

// ── results ──────────────────────────────────────────────────────────────────────

export interface VersionResult {
  readonly hatch: string;
  /** the newest protocol this hatch speaks */
  readonly protocol: number;
  /** the oldest client protocol still served unchanged. Absent before protocol 3 — a
   *  client reads a missing one as equal to `protocol`. */
  readonly protocolMin?: number;
  /** the newest config schema this hatch reads and writes */
  readonly configSchema: number;
  /** the oldest config schema still read. Absent before protocol 3, read as `configSchema`. */
  readonly configSchemaMin?: number;
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
  /** `<revision>:<path>` when the base came out of git, null when it was sent as text. */
  readonly baseSpec: string | null;
}

export interface ApplyResultMessage {
  readonly text: string;
  readonly hunks: readonly HunkLink[];
  readonly baseSpec: string | null;
}

export interface ConfigTemplateResult {
  readonly text: string;
  /** the schema version written */
  readonly version: number;
  /** where the core itself looks for the config from `path`: the repository root, or
   *  the directory of `path` outside a repository */
  readonly suggestedPath: string;
  /** whether a file is already there */
  readonly exists: boolean;
  /** every schema this hatch reads, oldest first, each with one line of what it holds */
  readonly versions: readonly { readonly version: number; readonly summary: string }[];
}
