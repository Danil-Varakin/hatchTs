
// ── the two pipelines ────────────────────────────────────────────────────────────
export { applyAll } from './core/apply.ts';
export type { ApplyResult, AppliedEdit } from './core/apply.ts';

export { synthesize } from './generate/synth.ts';
export type { SynthOptions, SynthEvent, Tracer } from './generate/synth.ts';

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
