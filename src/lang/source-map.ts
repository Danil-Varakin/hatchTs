// lang/source-map.ts — the contract between Hatch semantics and a language. The
// matcher and synth import only this file, never a concrete adapter.
//
// COORDINATES: every position here is CANONICAL (an index into the normalized source).
// Only marks are translated back, and only at the end, through toOriginalPos.

/**
 * Where a language's grammar comes from — part of what a LANGUAGE DECLARES, which is
 * why it lives in the contract and not next to the code that fetches it. Exactly one
 * shape is valid:
 *   • `path`                           — a .wasm shipped with the language, nothing is fetched;
 *   • `package` + `version` + `sha256` — an npm grammar package (the usual case);
 *   • `url` + `sha256`                 — anywhere else (a fork, an internal mirror).
 * `sha256` is mandatory for anything fetched: without a pin, "fetch it for me" would
 * mean "run whatever the network returns". How it is resolved: infra/grammar-store.ts.
 */
export interface GrammarSource {
  /** File name inside the package, and the name used in every cache directory. */
  readonly file: string;
  /** npm package of the grammar, e.g. `tree-sitter-go`. */
  readonly package?: string;
  /** EXACT version, never a range: the pin is what makes fetching reproducible. */
  readonly version?: string;
  /** Hex sha256 of the .wasm. Required unless `path` is used. */
  readonly sha256?: string;
  /** Explicit https URL, when the grammar is not on npm. */
  readonly url?: string;
  /** Absolute path to a local .wasm; skips lookup and fetching entirely. */
  readonly path?: string;
}

/** What an adapter's init() is allowed to do on its own. */
export interface InitOptions {
  /** Allow fetching a missing grammar over the network. Off unless asked. */
  readonly allowDownload?: boolean | undefined;
  /** Where progress goes; stderr by default — stdout carries the .md. */
  readonly log?: ((message: string) => void) | undefined;
}

/**
 * A block span in canonical coordinates. `open` is the opening token (in Python, the
 * start of the body), `close` its pair. The pair is computed once in buildMap.
 *
 * `headerStart` is where the owning construct's header begins, so the header is the
 * text [headerStart, open]: a function signature, `class Foo`, `if (...)`. Comes from
 * the adapter, is used by synth only, and is absent for a bare nested block.
 *
 * `closeEnd` is the end of the closing TOKEN, so [close, closeEnd) is that token.
 * Used by synth to close in a pattern what a parent anchor opened; absent in
 * languages that have no closing token.
 */
export interface BlockSpan {
  open: number;
  close: number;
  headerStart?: number;
  closeEnd?: number;
}

/**
 * An immutable map of one source file, built once per adapter.buildMap. All nesting
 * (braces in C++, indentation in Python) is already resolved here; the matcher only
 * queries it and compares numbers.
 */
export interface SourceMap {
  /** Whether an already normalized literal matches at pos, respecting token borders. */
  matchesAt(norm: string, pos: number): boolean;
  /**
   * Purely textual occurrences of norm starting in [from, to] — `to` INCLUSIVE, since a
   * literal like `}` or `} else {` legally starts on a closing token, and its tail may
   * run past `to`. No depth filter: structural selection belongs to the matcher.
   */
  occurrences(norm: string, from: number, to: number): number[];
  /**
   * End of the block enclosing pos; eof at top level. Not used in matching (synth and
   * diagnostics only). By convention inside = (open, close], so enclosingEnd(close) is
   * close itself.
   */
  enclosingEnd(pos: number): number;
  /** Nesting depth of a canonical position (diagnostics). */
  depthAt(pos: number): number;
  /**
   * Spans enclosing pos, whole, ordered innermost first. The matcher pushes their
   * closers onto its stack when a literal eats an opener; synth climbs them for context.
   */
  enclosing(pos: number): BlockSpan[];
  /**
   * Spans lying entirely within [from, to), ordered by rising open. Used by synth to
   * generalize anchors: bracket innards collapse into `...`. Bracket selection comes
   * from the map, not from the text, so `a < b` is never mistaken for `<>`.
   */
  blocksWithin(from: number, to: number): BlockSpan[];
  /** Canonical length of the source — the EOF anchor. */
  readonly eof: number;
  /**
   * A canonical mark position to an ORIGINAL offset. Relies on normalize touching only
   * whitespace, so the non-space characters line up.
   *   side='left'  → right after the previous non-space character;
   *   side='right' → right before the next one.
   */
  toOriginalPos(pos: number, side: 'left' | 'right'): number;
  /** The reverse: an original offset to a canonical position. Exact, no text search. */
  toCanonPos(origPos: number): number;
}

/**
 * A language adapter owns both language-dependent transforms: buildMap (how nesting is
 * resolved) and normalize (how text is canonicalized). A new language is a new
 * implementation of this interface; the core is untouched.
 */
export interface LanguageAdapter {
  /**
   * One-off async load of the tree-sitter engine and grammar, before any buildMap.
   * Grammars are not committed, so this may have to fetch one — which it does only
   * when the caller allows it (infra/grammar-store.ts).
   */
  init(options?: InitOptions): Promise<void>;

  /** Builds the immutable map for a file; synchronous, so async stays out of the core. */
  buildMap(source: string): SourceMap;

  /**
   * Canonical form of a literal or source text. C++ drops indentation and keeps a space
   * only between word characters; Python keeps leading indentation as a level marker.
   * The matcher caches the result per literal for one run.
   */
  normalize(raw: string): string;

  /** File extensions used to detect the language by file name. */
  extensions: readonly string[];

  /**
   * Where this language's grammar comes from, as the language declared it. The
   * `grammars` command reads it off the registry, so the list of grammars has one
   * source of truth: the language folders themselves.
   */
  readonly grammar: GrammarSource;
}
