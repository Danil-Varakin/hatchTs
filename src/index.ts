
// ── the two pipelines ────────────────────────────────────────────────────────────
export { applyAll } from './core/apply.ts';
export type { ApplyResult, AppliedEdit } from './core/apply.ts';

export { synthesize } from './generate/synth.ts';
export type { SynthOptions, SynthEvent, Tracer } from './generate/synth.ts';

// ── the same generate pipeline behind one call, on text instead of paths ─────────
export { generatePatch } from './generate/pipeline.ts';
export type { GenerateRequest, GenerateOutcome } from './generate/pipeline.ts';

// ── where hunks land: the .md, the baseline and the patched text, side by side ───
export { resolveHunks } from './core/resolve.ts';
export type { HunkLink, LinkFailure, LinkStatus, ResolveResult, Span } from './core/resolve.ts';

// ── the .md format: read and write ───────────────────────────────────────────────
export { parseHatchFile } from './core/hatch-parser.ts';
export { printHatchFile, trailingSpaceWarnings } from './generate/printer.ts';

// ── languages: a closed registry, and the only door into it ──────────────────────
export { adapterForLanguage, adapterForFile, supportedLanguages } from './lang/adapter.ts';

// ── errors: a caller must tell "did not fit" from "fits twice" ───────────────────
export {
  HatchError,
  ParseError,
  MatchError,
  AmbiguityError,
  ConfigError,
  GrammarError,
} from './core/errors.ts';

// ── types needed to write a signature against this API ───────────────────────────
export type { HatchFile, Hunk, MatchPattern } from './core/ast.ts';
export type { LanguageAdapter } from './lang/source-map.ts';
