# Changelog

Every release names its three numbers — package, protocol range, config schema range —
then what changed, breaking changes first. The rules for all three are in
[VERSIONING.md](./VERSIONING.md); an entry is written before its tag (P6).

## Unreleased

**Protocol 2–4 · config schema 1–2**

### Added

- Config schema 2 (additive, `CONFIG_MIN` stays 1): `generate.base.head`,
  `generate.base.branch`, `generate.base.commit` — the old version `generate` compares
  against, named once for the project as `--head` / `--branch` / `--commit` name it.
  With them set, `hatch generate --in <file>` needs no source flag. Any git flag
  replaces all three for that run; `--in-old` ignores them. Over the service, a
  `generate` that sends neither `baseText` nor `baseGit` takes this base (protocol 4,
  additive: such a request was refused before). A config with `"version": 1` is read
  as before; hatch 0.3.0 meeting `"version": 2` says to update hatch.

- `hatch init` writes a `hatch.config.json`: only `"$schema"` and `"version"`, so every
  default stays the built-in one. `--config-version <n>` picks the schema (a line on
  stderr when it is not the newest), `--dir` the directory (default: the git root around
  the current directory, outside a repository the directory itself), `--force` replaces
  an existing file (without it: exit 5, the file untouched), `--dry-run` prints instead.
- Protocol 4 (additive, `protocolMin` stays 2): the method `configTemplate` answers the
  text of a new config for a schema version and initial settings, the path the core
  would look for it at, whether a file is there, and every schema version in the range
  with a one-line summary. It writes nothing. A `ConfigError` about keys outside the
  chosen schema carries `detail.version` and `detail.keys`.
- Each config schema has its own JSON Schema, `schemas/hatch.config.v<N>.schema.json`,
  and a written config points its `"$schema"` at the one of its version — read from the
  tag of the release that shipped it, so a released schema never changes (until then,
  from `main`).
  `hatch.config.schema.json` stays the newest schema, for SchemaStore.

### Changed

- A config is checked against the keys of the schema its `"version"` names: a v1 file
  reads exactly as before, and `generate.base` in it is refused as a v2 key.

## 0.3.0 — 2026-09-28

**Protocol 2–3 · config schema 1–1**

### Added

- **Writing a hunk by hand.** When synthesis cannot anchor a change and a person is at
  the terminal, `generate` offers the editor (`$VISUAL` / `$EDITOR` / `vi`, `notepad`)
  with every hunk so far and a hunk to start from; the result is checked — it must parse
  and land on the old version — and asked about again until it does, or the run stops
  without a `.md`. Synthesis then goes on from what those hunks produce. Without a
  terminal the error is the same as before.

- `apply` reads the file to patch out of git with the same flags and the same rules as
  `generate` — `--head`, `--branch`, `--commit`, `--repo-path`. With a git coordinate
  `--in` only names the file: the repository, the default path in it, the name of the
  result; it need not exist on disk. `--verify --branch main` answers "does this patch
  still fit main" without checking anything out.
- A request git can carry out but that may not mean what it says is **asked about**
  instead of refused: a `--commit` not on the `--branch` named beside it, a tag or a
  raw sha given as `--branch`, and `apply` writing a git version over an `--in` that
  holds changes that version lacks. The default answer is no; `--yes` / `-y` answers
  yes in advance; with no terminal to answer the answer is no. What git cannot carry
  out at all is still refused, `--yes` or not.
- Service, protocol 3 (additive, `protocolMin` stays 2): `resolve` and `apply` take
  `baseGit` like `generate` does and answer `baseSpec`; `version` announces
  `protocolMin` and `configSchemaMin`.
- The config schema version is a range: a `"version"` newer than this hatch reads says
  "update hatch", an older one says "move the file", instead of one message for both.
- `hatch.config.json` is ready for the SchemaStore catalog (`.github/schemastore/`):
  once listed, VS Code and JetBrains check and complete it by the file name.
- `PROTOCOL.md`: the service contract — transport, methods, errors, the link table, how
  a client checks the version — in the repository and in the package.

### Breaking

- `generate -a`: `n` no longer leaves a hunk out. It offers to write the hunks by hand
  in the editor; refusing that — or having no terminal — stops the run without a `.md`.
  Hunks are asked about as they are made, not after all of them. Leaving a hunk out
  after the fact used to break the ones built on top of it (4 of 36 cases in the golden
  set) and wrote the broken `.md` silently. Shipped without the minor release F2 asks
  for, by the author's decision.
  → to keep a change out of the `.md`, take it out of the new version (`--in`) before
  generating, or answer `n` and edit that hunk away in the editor; a script that piped
  `n` to drop hunks now stops with exit 1.

### Changed
- `generate -a` stops when its input closes before every hunk is answered — piped
  answers running out, `< /dev/null`, CI — and writes nothing, saying at which hunk it
  stopped. It used to fail with "readline was closed". Answers may still be piped in,
  one line per hunk.
- An empty language — `--language ""`, `params.language: ""` — is the same as none in
  every command and service method, and the language comes from the heading or the
  extension. `apply` and the service's `generate` used to refuse it, `resolve` did not.

- `generate` writes the language's own name into `# match` — `cpp`, `objc`, `python` —
  in the CLI and in the service alike, however the language was picked. The CLI used to
  write the file's extension (`# match cc`) and the service the name, so one file gave
  two different `.md`. A visible change of the printed form only: every `.md` already
  written applies as before.

### Fixed

- A `.md` written by `generate` 0.2.0 or earlier for a `.m`, `.mm`, `.pyi`, `.kts`,
  `.mts`, `.cts` or `.inc` file applies: it names the language by the extension
  (`# match mm`), and `apply` did not know those extensions as names. Every extension a
  language claims is now also its name, and `generate` refuses to write a heading
  `apply` would read back as another language. The service's `version` lists the new
  names in `languages`.
- `--branch` names a branch even when a tag has the same name (`v1.2` the release
  branch beside `v1.2` the tag): git calls the short name ambiguous, and hatch used to
  answer "not a branch" — or, told `--yes`, read the tag. The service's `baseGit` too.
- `apply` asks before writing over `--in` when `--out` is the same file spelled another
  way — `F.cc` for `f.cc` on a case-insensitive disk.
- `--branch` / `--commit` values that start with `-` are refused before git sees them:
  `--branch --all` made git list every ref and hatch answer about a missing file.
- `hatch constructor`, `hatch toString` and the like are unknown commands; `hatch help
  constructor` no longer crashes with a stack trace.
- `hatch grammars` no longer reads every grammar in full just to see that it is there,
  and reports a cache entry that failed its checksum and was fetched again as
  `downloaded`, not `cache`.
- Writing a file keeps its permission bits (a script stays executable) and writes
  through a symlink to the file it points to, leaving the link a link — both used to be
  lost to the rename.
- `hatch.config.schema.json` has an `$id` that resolves, and its `version` description
  no longer spells out numbers that go stale.
- A patch applied to a CRLF file writes CRLF lines. A `.md` carries no line endings of
  its own — the parser reads `\r\n` and `\n` alike, and git or an editor may turn them
  either way — so a patch of several lines used to land with LF in the middle of a CRLF
  file, and `generate` → `apply` did not give the new file back. Now a bare LF of the
  patch takes the ending of the line the edit starts on. **An `apply` result changes**
  for multi-line patches on CRLF files only; the old result (mixed line endings) was
  the bug. LF files apply byte for byte as before. The same holds for the service's
  `resolve` and `apply`.
- The extension of a file is read from its name only: a dot in a directory
  (`my.proj/Makefile`) is no longer taken for one.

## 0.2.0 — 2026-09-24

**Protocol 2–2 · config schema 1–1**

### Breaking

- `--branch` takes a branch only; a tag or a raw sha is refused with a pointer to
  `--commit`.
  → pass a tag or a sha as `--commit v1.2`, not `--branch v1.2`.
- A value that is itself another option of the same command is refused
  (`--out --exact` used to write into a directory named `--exact`).
  → give every option that takes a value its value; a file literally named like an
  option goes as `./--exact`.
- `hatch.config.json` is looked for up to the repository root and never above the home
  directory: a config above the repository no longer applies.
  → move the file into the repository root (or pass it with `--config <path>`).
- `apply --out` follows the same placement rules as `generate --out`.
  → a relative `--out` now counts from the repository root and a directory gets the
  name of `--in` inside it; pass an absolute path to write exactly where you mean.

### Added

- The service: a long-running process speaking JSON over stdio — `version`, `generate`,
  `resolve`, `apply`, progress as separate messages. Hunk coordinates in both the base
  and the patched text. Protocol 1 was never released; this is protocol 2.
- Public API: `generatePatch` (the whole of `generate` on text) and `resolveHunks`.
- The old version out of git by three independent coordinates — `--head`, `--branch`,
  `--commit`, `--repo-path` — each one optional, each defaulted: the branch we are on,
  its last commit, the path of `--in`. `--branch` with `--commit` checks the commit is
  on the branch. The service takes the same as `baseGit`.
- One set of rules for `--out` in both commands: a directory or a file, missing
  directories created, a relative path from the repository root, `-` for stdout.
  `--mirror` / `generate.mirror` keeps patches in a tree of their own (the config key
  was added without raising the schema number — see VERSIONING.md).
- A misspelt option is met with the nearest one ("did you mean --branch?").
- `--log` overwrites its file instead of failing on it; a log that cannot be opened is
  a warning, the run goes on.

### Fixed

- Faster synthesis: the source map is built once per text, occurrences are counted
  lazily.

## 0.1.1 — 2026-08-27

**No service · config schema 1–1**

### Fixed

- The installed `hatch` command runs again: the `#!/usr/bin/env node` line is back.

## 0.1.0 — 2026-08-27

**No service · config schema 1–1**

First release.

- `hatch apply` — applies `.md` match/patch instructions to a source file, hunk by hunk.
- `hatch generate` — writes those instructions from two versions of a file, anchored
  structurally (enclosing blocks, not neighbouring lines), each hunk checked by applying
  it.
- `hatch grammars` — puts the tree-sitter grammars in place; the only command that goes
  online.
- Languages: C, C++, Objective-C, Java, Kotlin, JavaScript, TypeScript, TSX, Rust, Go,
  Python.
- `hatch.config.json` for the anchoring policy, with `--print-config` showing where
  every value came from.
- A public API (`applyAll`, `synthesize`, `parseHatchFile`, `printHatchFile`, the
  language adapters), `npm pack`, CI and the tag-driven release.
