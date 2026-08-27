# Contributing

> Русская версия: [CONTRIBUTING.ru.md](./CONTRIBUTING.ru.md)

Thanks for helping build Hatch. This file is the practical "how to work on it";
the design rationale is in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Prerequisites

- **Node 22+** — sources run via type-stripping, there is no build step.
- `npm install` pulls the three runtime dependencies: `web-tree-sitter` (WASM
  grammars — cross-platform, no compiler, no `node-gyp`), `diff` (line diff under
  `generate`) and `simple-git` (reading the old version out of a branch).
- Grammars load asynchronously: an adapter exposes `init(): Promise<void>`,
  awaited once at CLI startup, after which `buildMap` is synchronous. Anything
  that calls `buildMap` — including tests — must `await adapter.init()` first.

## Run & check

```bash
npm test           # node --test over test/**/*.test.ts
npm run typecheck  # tsc --noEmit over src/ and test/ (two configs)
npm run check      # both — run this before every commit
```

The CLIs are plain entry points and can be run directly or through the scripts:

```bash
npm run apply -- --match changes.md --in src/main.cpp --out out.cpp
npm run generate -- --in new.cpp --in-old old.cpp --debug
```

Both are green today; keep them that way. A red `tsc` is a blocked commit.

## The strict tsconfig (don't loosen without reason)

The config is intentionally strict; each flag earns its place:

- **`noEmit` + `allowImportingTsExtensions`** — tsc only type-checks; sources run
  through `node --experimental-strip-types`, so imports are written with the
  `.ts` extension. If you ever switch to building into `dist/`, restore the emit
  options and add `rewriteRelativeImportExtensions` (rewrites `.ts`→`.js`).
- **`verbatimModuleSyntax` + `isolatedModules`** — type-only imports MUST be
  `import type { … }`. The whole tree is written this way (e.g. a module imports
  types from `ast.ts` via `import type`, and the value `ParseError` via a normal
  `import`).
- **`noUncheckedIndexedAccess`** — index access (`arr[i]`, `m.groups[k]`) yields
  `T | undefined`. Handle it explicitly (`?? ''`, `.entries()`, guards, or `!`
  where an invariant guarantees presence).
- **`exactOptionalPropertyTypes`** — `hint?: string` does NOT include `undefined`;
  assign the field only when a value exists (`if (hint !== undefined) …`). When an
  options bag legitimately receives a computed `T | undefined`, widen that one
  field to `T | undefined` rather than loosening the flag.

## Code conventions

- **No parameter properties in constructors** — type-stripping doesn't support
  them. Declare fields explicitly (see `errors.ts`).
- Keep `core/` language-neutral. If a change there is "for C++" or "for Python",
  it belongs in an adapter under `lang/`. That's the boundary test. Concretely:
  no `case '}'`, no indentation rules, no tree-sitter import in `core/`.
- Comments explain **why**, not what. The tricky decisions in this codebase are
  all non-obvious trade-offs; a comment that restates the code is noise, one that
  records the failure mode a line prevents is worth its space.
- An invariant that can be violated by a bug should `throw`, not silently produce
  `undefined`. A bad index quietly turning into "the whole file" is the kind of
  bug that surfaces three modules away.
- Atomic file writes (`infra/fs.ts`): temp file + `rename`. The tool edits source
  files; a truncated file is a broken build.
- Errors extend `HatchError` and carry an `exitCode`. User-facing messages are in
  English and say what to do next.
- A new language never means editing `core/`: add a folder under `lang/` and two
  lines to the registry in `lang/adapter.ts`. The registry is a closed whitelist —
  never resolve a language name from a `.md` into a dynamic `import()`.

## How the code is organized

- `src/core/` — Hatch semantics, no language knowledge: `ast.ts`, `errors.ts`,
  `hatch-parser.ts` (one pass, incremental validation), `hatch-printer.ts`,
  `matcher.ts`, `patcher.ts`.
- `src/lang/` — all balancing and normalization: `source-map.ts` (the central
  contract), `adapter.ts` (the registry), the shared `canon.ts` / `build-map.ts` /
  `block-spans.ts` / `treesitter.ts`, and per-language folders (`cpp/`,
  `python/`).
- `src/generate/` — the reverse pipeline: `diff.ts` (atomic change segments),
  `synth.ts` (structural anchoring and verification), `printer.ts` (`.md`
  assembly), `agreement.ts` (the `-a` review loop, pure — `confirm` is injected).
- `src/infra/` — side effects: atomic writes, reading a file out of a git branch.
- `src/cli/` — `apply.ts` and `generate.ts`, each with its own small argument
  parser and a `main()` that maps `HatchError` to an exit code.

## Tests

- `test/unit/` — parser, printer, errors, matcher, patcher, source-map (tested
  **separately** from the matcher), canon, per-language normalizers, diff, synth,
  end-to-end `generate`.
- `test/roundtrip/` — `parse(print(ast))` ≡ `ast`.

Conventions that keep the suite useful:

- A test asserts a **behaviour with a reason**, and the reason goes in a comment.
  Several tests here exist because of a specific past bug; say which, so nobody
  "simplifies" the assertion away later.
- Prefer end-to-end assertions for the pipelines: generate hunks, apply them, and
  compare with the expected file. That catches interference between hunks, which
  per-module assertions miss.
- When you fix a bug, add the smallest input that reproduces it, and check that
  the new test actually fails against the old code before you keep it.

Keep the invariants in
[ARCHITECTURE.md](./ARCHITECTURE.md#diagnostics-and-invariants-green-on-every-commit)
green on every commit.

## Before opening a pull request

1. `npm run check` is green.
2. New behaviour has a test; a fixed bug has a regression test.
3. Public behaviour changes are reflected in `README.md` **and** `README.ru.md`,
   and the CLI `--help` text matches the README.
4. The commit message says *why*, not just *what* changed.

## Grammars

Grammars are not in the repository. Fetch them once after `npm install`:

```bash
npm run grammars
```

`npm test` runs this for you (`pretest`), so a fresh clone needs network access on
its first test run; afterwards everything comes from the shared user cache. Nothing
else ever downloads on its own — see the Grammars section of the README.


## Releasing

Releases are cut by **CI**, not by hand. All it takes is a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` then checks the tag against `version` in
`package.json` on a clean machine, runs typecheck and tests, builds `dist/`, runs
`npm pack` and creates the GitHub Release with the `.tgz` attached. Red tests mean no
release.

The tag/version check stops `v0.2.0` being cut from code that still calls itself
`0.1.0`: bump `package.json`, commit, then tag.

To build the archive locally, sending nothing anywhere:

```bash
npm run pack
```

To list the files without creating anything:

```bash
npm pack --dry-run
```

It must contain only `dist/`, both READMEs, `hatch.config.schema.json` and
`package.json` — the `files` field in `package.json` decides. Nothing from `src/`,
`test/` or `docs/`.

How a user installs it:

```bash
npm i -g https://github.com/Danil-Varakin/hatchTs/releases/download/v0.1.0/hatch-0.1.0.tgz
```

They get a `hatch` command. Grammars are not in the tarball (~17 MB across eleven
languages), so the first run tells them what to do: `hatch grammars`.

Installing straight from the repository works too
(`npm i -g github:Danil-Varakin/hatchTs`) — that is what `prepare` is for.

## Checks (CI)

`.github/workflows/ci.yml` runs on every push and pull request:

- **matrix** — Linux, macOS, Windows across Node 22 and 24, six combinations;
- **grammars** are cached between runs (`HATCH_GRAMMAR_CACHE` points at a directory
  inside the workspace, which `actions/cache` remembers);
- **a separate job** builds the package and prints its contents, so a stray file in
  `files` shows up before it ships.

`test/golden` runs as part of `npm test`.

## Corpus and golden

`test/golden/` holds 345 hand-written cases across eleven languages. They live in the
repository and run with plain `npm test`, and they check TWO different things:

- **round-trip** — `synthesize → print → parse → apply → compare with new`: the result
  is correct;
- **golden** — the printed `.md` is compared byte for byte with a committed snapshot.
  Round-trip says nothing about shape: a hunk that rewrites a whole function body
  reproduces the file just as faithfully as a one-line one.

When a change is MEANT to alter the printed form, regenerate and **read the diff**:

```bash
UPDATE_GOLDEN=1 npm test
```

Two markers, both on the first line of a case:

- `MUST-REFUSE` — the instructions must NOT apply (a silent false match is the worst
  class of bug we have, so it gets a test);
- `KNOWN-GAP` — synthesis cannot do this yet, said out loud. Fix it and the test fails
  with "it works now, remove the marker".

Hatch has also been exercised against real Chromium files carrying real Brave patches.
That material is third-party code under a third-party licence and is not part of this
repository; `test/golden` is the suite everyone can run.
