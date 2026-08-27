import type { HunkLink } from '../core/resolve.ts';
import type { PartialLimits } from '../generate/synth.ts';

// Everything the wire format mentions is re-exported here, so a client can type its
// whole side of the conversation against this one module and nothing else.
export type { HunkLink, LinkFailure, LinkStatus, ResolveResult, Span } from '../core/resolve.ts';
export type { PartialLimits, SynthLimits } from '../generate/synth.ts';

// The contract between hatch and a long-lived client (an editor extension, a bot).
// One JSON object per line, in both directions: stdout carries protocol only, stderr
// carries logs. Payloads hold whole files, and JSON escapes newlines, so a line-
// delimited stream is safe for them.
//
// Bump PROTOCOL_VERSION when an existing field changes meaning or goes away. A client
// asks `version` first and refuses to talk to a number it does not know.

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
  /** machine-readable extras: mdLine for a parse error, the grammar for a grammar one */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ResponseMessage =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: ServiceError };

/** Sent while a request is still running. Never a reply — it carries no `ok`. */
export interface ProgressMessage {
  readonly method: 'progress';
  readonly params: { readonly id: number; readonly done: number; readonly total: number };
}

// ── params ───────────────────────────────────────────────────────────────────────

/** Common to every method that has to parse source: how the language is decided. */
export interface LanguageParams {
  /** language name; when absent, taken from `path`, or from the `# match` heading */
  readonly language?: string;
  /** a file name — only its extension is read, the file is never opened */
  readonly path?: string;
  /** allow fetching a missing grammar (off by default, as in the CLI) */
  readonly allowDownload?: boolean;
}

export interface GenerateParams extends LanguageParams {
  /** the version being patched */
  readonly baseText: string;
  /** the version the user has now, buffer included — no file is read */
  readonly newText: string;
  readonly exact?: boolean;
  readonly bridgeGap?: number;
  readonly limits?: PartialLimits;
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

export interface GenerateResult {
  readonly md: string;
  readonly language: string | undefined;
  readonly warnings: readonly string[];
  readonly hunks: readonly HunkLink[];
  /** false means the .md does not reproduce newText — report it, do not hide it */
  readonly reproducesNew: boolean;
}

export interface ResolveResultMessage {
  readonly hunks: readonly HunkLink[];
}

export interface ApplyResultMessage {
  readonly text: string;
  readonly hunks: readonly HunkLink[];
}
