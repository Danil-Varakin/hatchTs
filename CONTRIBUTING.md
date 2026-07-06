# Contributing

> Русская версия: [CONTRIBUTING.ru.md](./CONTRIBUTING.ru.md)

Thanks for helping build Hatch. This file is the practical "how to work on it";
the design rationale is in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Prerequisites

- **Node 22+** (sources run via type-stripping; no build step).
- That's it for the core. From phase 2 on, the language adapters depend on
  **`web-tree-sitter`** plus the grammar `.wasm` files (`tree-sitter-cpp.wasm`,
  later `tree-sitter-python.wasm`). These are WASM, not native — cross-platform,
  no compiler, no `node-gyp`. They load asynchronously: the adapter exposes
  `init(): Promise<void>`, awaited once at CLI startup, after which `buildMap` is
  synchronous. Bundle the `.wasm` via package.json `files`.
- The CLI layer will later want `@types/node` (see the commented block in
  `tsconfig.json`); `web-tree-sitter` ships its own types.

## Run & type-check

Run any `.ts` directly:

```bash
node --experimental-strip-types src/cli/index.ts apply --match changes.md --in src/main.cpp
```

Type-check the whole source tree (no JS is emitted — `noEmit`):

```bash
npx tsc -p tsconfig.json
```

A green `tsc` run is required before every commit. The core already passes with
zero errors under the strict config below.

## The strict tsconfig (don't loosen without reason)

The config is intentionally strict; each flag earns its place:

- **`noEmit` + `allowImportingTsExtensions`** — tsc only type-checks; sources run
  through `node --experimental-strip-types`, so imports are written with the
  `.ts` extension. If you ever switch to building into `dist/`, restore the emit
  options and add `rewriteRelativeImportExtensions` (rewrites `.ts`→`.js`).
- **`verbatimModuleSyntax` + `isolatedModules`** — type-only imports MUST be
  `import type { … }`. The whole `core/` is written this way (e.g. `parser.ts`
  imports types from `ast.ts` via `import type`, and the value `ParseError` via a
  normal `import`).
- **`noUncheckedIndexedAccess`** — index access (`arr[i]`, `m.groups[k]`) yields
  `T | undefined`. Handle it explicitly (`?? ''`, `.entries()`, guards).
- **`exactOptionalPropertyTypes`** — `hint?: string` does NOT include `undefined`;
  assign the field only when a value exists (`if (hint !== undefined) …`).

## Code conventions

- **No parameter properties in constructors** — type-stripping doesn't support
  them. Declare fields explicitly (see `errors.ts`).
- Keep `core/` language-neutral. If a change there is "for C++" or "for Python",
  it belongs in an adapter under `lang/`. That's the boundary test.
- Atomic file writes (`infra/fs.ts`): temp file + `rename`. The tool edits
  source files; a truncated file is a broken build.
- Errors extend `HatchError` and carry an `exitCode`.

## How the code is organized

See [docs/structure.md](./docs/structure.md) for the full tree and per-module
status. The short version:

- `src/core/` — Hatch semantics, no language knowledge: `ast.ts`, `errors.ts`,
  `parser.ts` (one pass, incremental validation), `printer.ts`, plus the
  upcoming `matcher.ts` and `patcher.ts`.
- `src/lang/` — all balancing and normalization: `source-map.ts` (the central
  contract), per-language folders (`cpp/`, `python/`) each with their own
  `normalize.ts` and map builder.
- `src/generate/`, `src/infra/`, `src/cli/` — the `generate` pipeline, side
  effects (git, atomic fs), and the commander CLI.

## The phase plan

Development is staged so each phase yields a testable artifact, and the riskiest
module (the structure map) gets a foundation before the matcher. Full detail per
phase in [docs/phase-1..5-*.md](./docs).

1. **Parsing core (no language).**  done & tested — `ast`, `errors`, `parser`,
   `printer`. Round-trip green, forbidden combinations rejected with line numbers.
2. **C++ `SourceMap` (tree-sitter).** `source-map.ts` (contract),
   `cpp/normalize.ts`, then `cpp/treesitter.ts` (web-tree-sitter wrapper),
   the shared `lang/canon.ts` (canonical string + non-whitespace alignment for
   `toOriginal` and node-offset mapping), and `cpp/index.ts`. tree-sitter provides
   the brace pairs; we keep canon/normalize. Test the map in isolation.
3. **Matcher + patcher (vertical slice of `apply`).** Cursor walk over steps in
   canonical coordinates, windows via `pair`, marks translated to original via
   `toOriginal`. Hunks apply **sequentially** (each against the current state),
   one atomic write at the end. First end-to-end patch.
4. **`generate`.** diff → synth (climbing `enclosing()` of the same map) →
   printer. Sequential apply lets synth emit dependent hunks for clustered
   changes. Closes the system round-trip.
5. **Python + hardening.** `python/normalize.ts` (ours) over a
   `tree-sitter-python` structure provider, the `-a` agreement mode,
   string-aware canon via tree-sitter's string nodes, robustness to `ERROR` nodes.

## Tests

- `test/unit/` — parser, source-map (separately from the matcher!),
  cpp/normalize, py/normalize, matcher.
- `test/roundtrip/` — `parse(print(ast)) ≡ ast`.
- `test/golden/` — four real-world patches with expected output.

Keep the invariants in [ARCHITECTURE.md](./ARCHITECTURE.md#diagnostics-and-invariants-green-on-every-commit)
green on every commit.

## Two decisions to record in the README before real patches exist

These can't be derived from syntax and must be stated by fiat, or patches will
diverge in interpretation. They're already in the README — keep them authoritative:
`^n..` is 1-based; `<<<` replaces inclusively; region closing is `}` in C++ and an
outer-indent anchor (or implicit `...`) in Python.
