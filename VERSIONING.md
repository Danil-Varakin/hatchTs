# Versioning

These rules are binding. A change that breaks one is not merged until the rule is
followed or the rule itself is changed here first, in its own commit, with the reason.
`test/unit/versioning.test.ts` checks the parts a machine can check.

hatch carries **three independent numbers** and two compatibility surfaces without one:

| what | where it lives | who depends on it |
|---|---|---|
| package version | `package.json`, `package-lock.json`, git tag `vX.Y.Z` | users, the release workflow |
| protocol range | `PROTOCOL_MIN`..`PROTOCOL_VERSION`, `src/service/protocol.ts`; announced by `version`; described in [PROTOCOL.md](./PROTOCOL.md) | service clients (the VS Code extension) |
| config schema range | `CONFIG_MIN`..`CONFIG_VERSION`, `src/infra/config/schema.ts`; `hatch.config.schema.json` | `hatch.config.json` files committed to projects |
| the `.md` patch format | `core/hatch-parser.ts`, `test/golden/` | every patch anyone has written |
| the CLI | `src/cli/` | scripts and CI jobs |

Protocol and config are **ranges, never single numbers**: a hatch serves every client
and reads every config from the minimum to the maximum. A range is what lets an older
client or an older config keep working after the number moves.

## 1. Package version

- **P1.** `X.Y.Z`. The tag is `v` + that version exactly; the release workflow refuses a
  mismatch.
- **P2.** Before 1.0.0: **minor** (`Y`) for any new feature and for any breaking change;
  **patch** (`Z`) only for a fix that changes no documented behavior. From 1.0.0: major
  for breaking, minor for features, patch for fixes.
- **P3.** Breaking, for the package: a CLI flag removed, renamed or given another
  meaning; the same input now refused where it succeeded, or succeeding differently
  (unless the old outcome was a bug); an exit code changed; a `.md` an older release
  wrote no longer applies the same (F1); `PROTOCOL_MIN` or `CONFIG_MIN` raised; an
  export of `src/index.ts` removed or changed; the minimum Node (`engines`) or the
  minimum git raised; a language name or a file extension no longer accepted (a `.md`
  headed `# match mm` must keep applying); a grammar pin changed so that an apply golden
  changes (F3).
- **P4.** A release that moves the protocol or config range is at least a minor bump.
- **P5.** The version is raised in a commit of its own, `package.json` and
  `package-lock.json` together — `npm version minor|patch` does both.
- **P6.** Every release has its `CHANGELOG.md` entry before the tag: the three numbers,
  then what changed, breaking changes first.
- **P7.** A version that went out is never re-cut: a pushed tag is not moved, deleted
  and re-pushed, or reused. A mistake is fixed by the next patch release.

## 2. Protocol

The contract is everything a client can observe through `src/service`: methods, every
field of params and results, error kinds and their `detail`, and every validation rule.

- **R1.** The server announces a range in `version`: `protocol` = **N**, the newest it
  speaks; `protocolMin` = **M**, the oldest client contract it still serves unchanged.
  `M ≤ N`, always.
- **R2.** **Every** change to the contract raises N, additions included. Nothing ships
  under a number that already meant something else. *(Why: protocol 1 changed meaning
  inside `dev` with no bump — relative `path` accepted, then refused — so "protocol 1"
  named two contracts.)*
- **R3.** One bump per release. The first protocol change after a release sets
  N = released N + 1; further changes before the next release amend that same N. A
  number is frozen the moment a release ships it.
- **R4. Additive** — an existing client cannot notice it: a new optional param, a new
  result field, a new method, a new `detail` field. N + 1, **M unchanged**.
- **R5. Breaking** — an existing client can trip over it: a field removed or renamed,
  optional made required, a meaning or a default changed, validation made stricter, a
  result field removed. N + 1 **and M = N + 1** — and it is breaking for the package
  too (P3).
- **R6.** Prefer R4 to R5: keep the old behavior reachable and add the new one beside it.
- **R7.** A server that sends no `protocolMin` (protocol 2 and older) is read as M = N.
- **R8. Clients** declare their own range `[a, b]`: `b` the newest protocol the client
  was written and tested against, `a` the oldest it still works with. They are
  compatible iff `a ≤ N` and `M ≤ b`. The client works at `min(N, b)` and does not use
  anything newer. A mismatch names the side to update: `N < a` — update hatch;
  `M > b` — update the client.
- **R9.** Equality checks on the protocol number are forbidden on both sides. They break
  every client on every bump, compatible or not.
- **R10.** Every N gets a row in the protocol table below and its section in
  [PROTOCOL.md](./PROTOCOL.md) ("Protocol versions"), which describes the contract as
  it stands. A test holds both.

## 3. Config schema

- **C1.** hatch reads every config whose `"version"` is in `[CONFIG_MIN, CONFIG_VERSION]`
  and writes `CONFIG_VERSION`. `hatch.config.schema.json` states the same range; a test
  holds the two together.
- **C2.** A new optional key: `CONFIG_VERSION + 1`, `CONFIG_MIN` unchanged. Committed
  configs load as before, and an older hatch meeting the new number says "update
  hatch" instead of "unknown key".
- **C3.** A key removed or renamed, its meaning or default changed: `CONFIG_MIN` rises
  with it — breaking for the package (P3). Prefer keeping the old key readable.
- **C4.** One bump per release, frozen on release — as R3.
- **C5.** Outside the range the message names the side: newer — update hatch; older —
  move the file to the current schema.
- **C6.** Every `generate` option the core supports has a config key under `generate`,
  shipped in the same release as the option — a flag, a protocol param or both. *(Why:
  what a project settles once — how much context a hunk carries, what it is compared
  against — must not have to be retyped on every run or taught to every client
  separately.)* Exempt, because they name one run and not the project: the files of
  that run (`--in`, `--in-old`, `baseText`, `newText`, `path`, `--repo-path`), where the
  config itself comes from (`--config`, `--no-config`, `--print-config`), how the run
  talks to a person (`--agreement`, `--yes`, `--help`, `--debug`, `--log`) and
  permission to download (`--download-grammars`, `allowDownload`). A new exemption is
  added here, with its reason, before the option ships without a key. A key follows C2:
  schema + 1.

## 4. What has no number

- **F1. The `.md` format.** Every `.md` a released hatch wrote must parse and apply the
  same in every later release. `test/golden/*/apply/` holds this: an apply golden whose
  expected result changes is a breaking change unless the old result was a bug, and the
  commit says which. `test/golden/*/generate/` is different — it records the form
  `generate` prints; changing that form breaks no existing patch, so it is not breaking,
  but it is a visible change and goes into the CHANGELOG.
- **F3. Grammar pins.** A grammar is part of how a `.md` applies: a new version can
  shape the tree differently and move where a hunk lands. Every change of a pin in
  `src/lang/*/index.ts` runs the apply goldens; one whose expected result changes makes
  the change breaking (P3), unless the old result was a bug, and the commit says which.
- **F2. The CLI.** A flag may be added in any minor release. Removing, renaming or
  changing one is breaking (P3), and goes through one minor release first where the old
  spelling still works and warns. A flag that never shipped in a release may still be
  renamed freely.

## 5. Releasing

1. Everything for the release is committed on `dev`, and `CHANGELOG.md` has its entry
   with the three numbers (P6). The tables below are up to date (R10).
   A config schema version shipping for the first time gets its row in
   `SCHEMA_RELEASED_IN` (`src/infra/config/template.ts`) with this release's tag: from
   then on a written config's `"$schema"` points at that tag, which never moves (P7),
   so the released schema file cannot change under anyone.
2. `npm run check` is green.
3. The version bump, alone in its commit (P5):
   `npm version minor -m "поднята версия"` (or `patch`, by P2).
4. `git push origin dev`, then a pull request `dev` → `main`, merged.
5. `git push origin vX.Y.Z` — the tag starts `.github/workflows/release.yml`, which
   checks the tag against `package.json`, runs typecheck and tests, packs and publishes
   the GitHub Release. Nothing goes to the npm registry.

## 6. Compatibility

### Releases

| hatch | date | protocol M–N | config M–N | |
|---|---|---|---|---|
| 0.1.0 | 2026-08-27 | — no service | 1–1 | first release |
| 0.1.1 | 2026-08-27 | — no service | 1–1 | fix |
| 0.2.0 | 2026-09-24 | 2–2 | 1–1 | the service arrives |
| 0.3.0 | 2026-09-28 | 2–3 | 1–1 | apply from git, hand-written hunks, CRLF, PROTOCOL.md |

### Protocol

| N | first release | kind | what changed |
|---|---|---|---|
| 1 | never released | — | lived only inside `dev`; named two contracts (R2) |
| 2 | 0.2.0 | first | `version`, `generate`, `resolve`, `apply`; `generate` takes `baseText` or `baseGit`, answers `baseSpec`; `params.path` must be absolute |
| 3 | 0.3.0 | additive, M = 2 | `resolve`/`apply` take `baseGit` and answer `baseSpec`; `version` announces `protocolMin` and `configSchemaMin`; every file extension is also a language name (`languages` grows); `generate` writes the language's own name into `# match`; `baseGit.branch` finds a branch that shares its name with a tag; `language: ""` means none in every method; a patch lands in a CRLF base with CRLF lines — a fix, the old mixed endings were the bug |
| 4 | unreleased | additive, M = 2 | `configTemplate`: the text of a new `hatch.config.json` for a schema version and settings, `suggestedPath`, `exists`, `versions`; a `ConfigError` about keys outside the schema carries `detail.version` and `detail.keys`; `generate` with neither `baseText` nor `baseGit` takes the config's `generate.base` (refused before); `config.settings` grows `baseHead`, `baseBranch`, `baseCommit` |

### Config schema

| N | first release | kind | what changed |
|---|---|---|---|
| 1 | 0.1.0 | first | `generate`: `out`, `language`, `exact`, `bridgeGap`, `parents`, `siblings` |
| 1 | 0.2.0 | **added without a bump** | `generate.mirror` — before these rules; by C2 it would be schema 2. A config using it, read by hatch 0.1.x, fails with "unknown key" rather than "update hatch". Left as released (P7); marked `unbumpedIn` in `FIELDS` and in the v1 summary |
| 2 | unreleased | additive, M = 1 | `generate.base`: `head`, `branch`, `commit` — the old version out of git, as `--head` / `--branch` / `--commit` (C6) |

### Clients

| client | version | protocol it speaks | |
|---|---|---|---|
| VS Code extension (`HatchVSCodeExtension-`) | 0.0.1, unreleased | 2–4 | range check as R8; `configTemplate` only from protocol 4 |

## 7. Support

- **S1.** Before 1.0.0 fixes ship only in the next release from `dev`; there are no
  patch releases of an older minor. From 1.0.0: fixes go to the latest minor (§8),
  security fixes to the latest and the previous one.
- **S2.** `PROTOCOL_MIN` or `CONFIG_MIN` rises only in a release that is allowed to break
  (P2: a minor before 1.0.0, a major from it), and the release before it says so in its
  `CHANGELOG.md` entry: which number rises, and what to update.
- **S3.** A client version that speaks the new protocol ships before, or together with,
  the hatch that raises `PROTOCOL_MIN`; the Clients table in §6 is updated with it.
- **S4.** A Node version is dropped only after its end of life, only in a release that is
  allowed to break, and announced one release ahead as in S2. The same holds for the
  minimum git.

## 8. Patch releases from 1.0.0

Before 1.0.0 there are none (S1). From 1.0.0, a fix for a released line that must not
wait for everything else on `dev`:

1. A branch `release/X.Y.x` from the tag `vX.Y.0` (or the last `vX.Y.Z`).
2. Only fixes on it: nothing that changes documented behavior (P2), and neither range
   moves (P4).
3. The fix is committed there, or cherry-picked from `dev`; `CHANGELOG.md` gets the
   `X.Y.Z+1` entry; `npm version patch` alone in its commit (P5); the tag goes from
   this branch — the release workflow starts from the tag, whatever the branch.
4. The fix and its `CHANGELOG.md` entry are merged forward into `dev` and `main`.

