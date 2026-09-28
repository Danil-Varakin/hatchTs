# The service protocol

hatch can run as a long-lived process that speaks JSON over stdio. It is the same core
as the CLI — generate, resolve, apply — behind a different door: text in, coordinates
out. It is what the VS Code extension talks to, and anything else can talk to it too.

The contract below is binding and versioned: [VERSIONING.md](./VERSIONING.md) §2 says
when the protocol number moves and what a client may rely on. The TypeScript types are
in `src/service/protocol.ts`, published as `hatch/protocol`.

## Why a service and not the CLI

- **Unsaved text.** The CLI reads files; an editor has a buffer that is not on disk.
  The service takes text and writes no files.
- **Coordinates, not text.** The CLI prints a `.md`. An editor needs offsets — where
  each hunk lands — to jump between patch and file, underline, and show CodeLens.
- **One grammar load.** Grammars load once per process; a live process pays once.
- **Progress.** Synthesis reports progress as messages, not as lines in stderr.

## Starting it

```bash
node node_modules/hatch/dist/service/index.js
```

From a clone: `npm run service`. From code: `import { serve } from 'hatch/service'`,
which takes an input and an output stream. Grammars must be in place (`hatch grammars`)
unless a request sets `allowDownload`.

## Transport

- One JSON object per line, UTF-8, both ways. Line breaks inside strings are escaped
  by JSON, so a patch body never breaks a line.
- **stdout carries the protocol and nothing else.** Diagnostics (grammar loading and
  the like) go to stderr.
- Requests are served **one at a time, in order**. Synthesis is synchronous, so a
  running request cannot read a cancel: **to cancel, kill the process**. The next
  start pays one grammar load.
- A line that is not JSON gets an error reply with `id: 0`. Empty lines are skipped.
  A request whose `id` is not a number is answered with `id: 0`.

```jsonc
{ "id": 1, "method": "generate", "params": { … } }                        // request
{ "id": 1, "ok": true,  "result": { … } }                                 // reply
{ "id": 1, "ok": false, "error": { … } }                                  // the CALL failed
{ "method": "progress", "params": { "id": 1, "done": 3, "total": 12 } }   // notification
```

## Two levels of failure

A client must tell them apart:

| where | what it looks like | for example |
|---|---|---|
| **the call failed** | `ok: false`, `error` instead of `result` | the `.md` does not parse, the language is unknown, the grammar is missing |
| **one hunk did not land** | `ok: true`, that hunk's `status` is not `ok` | an anchor not found, a pattern that fits twice |

The second is normal, not a crash: hunk 2 failing says nothing about hunk 1, and the
other hunks are resolved as usual. `apply` still returns `text` — with the hunks that
landed.

### The error object

| field | |
|---|---|
| `kind` | `BadRequest` for a malformed request; otherwise the error class: `ParseError`, `MatchError`, `AmbiguityError`, `ConfigError`, `GrammarError`, `LanguageError`, `GitError`, `PathError`; anything unexpected keeps its own name |
| `message` | a human sentence, English |
| `exitCode` | what the CLI would exit with for the same failure |
| `detail` | machine fields, present when the kind has any (below) |

| kind | `detail` |
|---|---|
| `ParseError` | `mdLine`, `hint?` |
| `MatchError` | `failedStepIndex`, `totalSteps?`, `origPos?`, `anchorText?` |
| `AmbiguityError` | `positions` |
| `PathError` | `path`, `blocker` |
| `LanguageError` | `language?`, `extension?` |
| `GitError` | `revision?` |
| `GrammarError` | `grammar?` |
| `ConfigError` | `file?` |

## Versions: a range on each side

The first call is `version`. It announces a **range**: `protocol` is the newest
protocol this hatch speaks, `protocolMin` the oldest client contract it still serves
unchanged. A client declares its own range `[a, b]` — `b` the newest protocol it was
written and tested against, `a` the oldest it still works with — and:

- they are compatible when `a ≤ protocol` and `protocolMin ≤ b`;
- the client then works at `min(protocol, b)` and uses nothing newer;
- a mismatch names the side to update: `protocol < a` — update hatch;
  `protocolMin > b` — update the client;
- **never compare protocol numbers for equality.** That breaks every client on every
  release, compatible or not.

A hatch that sends no `protocolMin` (protocol 2) is read as `protocolMin = protocol`.
Every change to this contract raises `protocol`, once per release; a change an existing
client can trip over raises `protocolMin` with it. A client must ignore fields it does
not know — a new field is how most changes arrive.

## Methods

Params shared by methods that look at a language:

| param | |
|---|---|
| `language` | a language name — any of `version().languages` |
| `path` | the file this is about, **absolute**: the service has no meaningful current directory. Gives the language by extension when neither `language` nor the `.md` heading names one, and anchors `baseGit` and the config search |
| `allowDownload` | `true` lets this call fetch a missing grammar (off by default; `HATCH_GRAMMARS_DOWNLOAD=1` in the service's environment does the same) |

The language is taken from `language`, else the `# match` heading of the `.md`
(`resolve`, `apply`), else the extension of `path`. An empty `language` is the same as
none.

### The base: sent as text, or named in git

`generate`, `resolve` and `apply` each work from one version of the file — the OLD one
for `generate`, the one to patch for `resolve`/`apply`. Send **exactly one** of:

- `baseText` — the text;
- `baseGit` — `{ branch?, commit?, repoPath? }`, the same three coordinates as the
  CLI's `--branch`, `--commit`, `--repo-path`. What is left out takes its default:

  | field | left out means |
  |---|---|
  | `branch` | the branch the repository is on |
  | `commit` | the last commit of that branch |
  | `repoPath` | the path of `path` inside the repository; a relative one counts from the repository root |

  `baseGit: {}` is "this same file, as of the last commit here". It needs `path`: the
  repository is found from it. A field outside the three is refused by name, and so is
  an empty one; a `branch` or `commit` that starts with `-` is refused too — git would
  read it as an option. `branch` must be a branch, local or remote-tracking — also when
  a tag shares its name. A `commit` alone is taken as given; beside a `branch` it must
  be one that branch holds.

  The base out of git has the line endings the repository stores. In a repository with
  `core.autocrlf=true` that is LF while the file on disk has CRLF — send `baseText`
  there, or `generate` sees every line as changed.

**Nothing is asked over a pipe.** Where the CLI asks before going on (a commit off the
named branch, a tag given as the branch), there is no one to answer, so the service
answers no and replies with a `GitError` carrying the same message. A client that wants
to ask its user shows that message and, on a yes, sends a request that does not
contradict itself — the commit without the branch, say.

Every result that read a base says what it read: `baseSpec` is `<revision>:<path>` for
a base out of git, `null` for one sent as text.

### `version`

No params.

```jsonc
{ "hatch": "0.3.0", "protocol": 3, "protocolMin": 2,
  "configSchema": 1, "configSchemaMin": 1, "languages": ["cpp", "c++", …] }
```

`configSchema`/`configSchemaMin` is the range of `hatch.config.json` versions this
hatch reads. `languages` is every name `language` and the `# match` heading accept,
each file extension without its dot included (`mm`, `pyi`).

### `generate`

The `.md` that turns the base into `newText`.

| param | |
|---|---|
| `newText` | the new version — typically the unsaved buffer. Required |
| the base | `baseText` or `baseGit`, above |
| `language`, `path`, `allowDownload` | above |
| `exact` | reproduce `newText` byte for byte, not only after normalization |
| `bridgeGap` | join edits separated by at most this many unchanged lines into one hunk |
| `limits` | anchoring limits: `minParents`, `maxParents` (a number or `"all"`), `parentDetailBase`, `minSiblings`, `maxSiblings`, `siblingDetailBase`, `parentsRequired` |
| `out`, `mirror` | where the `.md` belongs, as `generate.out` / `generate.mirror` — only reported back, nothing is written |

With a `path`, `hatch.config.json` is looked for upward from the file's directory, up
to the repository root and never above the home directory; params override it the way
flags override it in the CLI. Without a `path` no config file is read.

| result | |
|---|---|
| `md` | the `.md`. Its heading names the language by its own name (`# match cpp`) |
| `language` | that name |
| `baseSpec` | what the base was |
| `warnings` | e.g. a patch line whose trailing whitespace is significant |
| `hunks` | the link table (below), resolved against the base |
| `reproducesNew` | `false` when applying `md` to the base does not give `newText` byte for byte — reported, not hidden |
| `outPath` | where the CLI would write this `.md`, or `null` without a `path` |
| `config` | `{ file, settings, origins }`: the config file used (or `null`), every setting, and where each came from |

While it works, `generate` sends `progress` notifications: `done` of `total`, where
`total` is known before synthesis starts.

### `resolve`

Where the hunks of a `.md` land — without the text.

| param | |
|---|---|
| `md` | the `.md`. Required |
| the base | `baseText` or `baseGit` |
| `language`, `path`, `allowDownload` | needed only when the heading names no language; `path` is required with `baseGit` |

Result: `hunks` (below) and `baseSpec`. **One call per `.md`**, not per hunk: hunks are
replayed in order, hunk *k* matched against the text in which hunks 1..*k*−1 already
landed.

### `apply`

What `resolve` returns, plus `text` — the base with the hunks applied. A separate
method only so that `resolve`, called often, does not send the whole file back each
time.

A patch takes the line endings of the base: in a CRLF base every line it writes ends in
CRLF (protocol 3; before, such lines ended in LF).

## The link table: `hunks`

One entry per hunk, in the order of the `.md` — which is also the order they apply in.

| field | |
|---|---|
| `index` | the hunk's position in the `.md`; the key a client ties its CodeLens, underline and own table to |
| `status` | `ok` · `no-match` · `ambiguous` · `error` |
| `mdSpan` | `[from, to]`, lines of the `.md` from `# match` to the closing `# end`, counted from 1 |
| `base` | `{ start, end }` — what the hunk REPLACES, in base coordinates; `start === end` is an insertion |
| `final` | `{ start, end }` — what the hunk WRITES, in coordinates of the applied text |
| `finalText` | the text at `final`, so a client can compare it with its buffer without a second call |
| `dependsOnEarlier` | the pattern does not match the clean base and lands only after earlier hunks |
| `failure` | when `status` is not `ok`: the machine fields of the failure |

**Offsets are UTF-16 code units** (JavaScript string indices), not bytes — what
`String.slice` counts and what VS Code's `positionAt` takes. Do not mix them with
`Buffer.byteLength`.

`base` and `final` are two projections, not one number told twice: hunk *k* matches in
a text where the earlier hunks have landed, a stage no open editor shows. `resolve`
carries each edit back through the earlier ones and forward through the later ones.
A hunk with `dependsOnEarlier` has no place of its own in the base: its `base` is the
point an earlier hunk writes to. A client should not offer a jump into the base for
it, but name the hunk it depends on; its `final` is exact.

`failure`:

| field | |
|---|---|
| `kind` | `MatchError`, `AmbiguityError`, or the error's class |
| `message` | the human sentence |
| `mdLine` | the `.md` line of the anchor that did not match — **where to underline** |
| `failedStepIndex`, `totalSteps` | "anchor 3 of 5 not found" |
| `origPos` | how far the pattern got before it gave up, in base coordinates |
| `anchorText` | the anchor that did not match |
| `candidates` | for `ambiguous`: every place the pattern fits, in base coordinates |

## Not in the replies, on purpose

- **File paths.** The service takes text and returns coordinates; which file was the
  base and where a `.md` goes is the client's knowledge (`outPath` is advice, and
  nothing is written).
- **The `.md` in a `resolve` reply.** The client has it.
- **Positions of individual anchors.** The matcher reports the insertion point and the
  end of the replacement; on failure `failedStepIndex` and `origPos` are enough.

## Protocol versions

Each number, what it added and what a client written for it can count on. The
compatibility table is in [VERSIONING.md](./VERSIONING.md) §6.

### Protocol 1

Never released. It lived inside `dev` only and named two contracts — a relative `path`
accepted, then refused — which is why every change now raises the number.

### Protocol 2

hatch 0.2.0. `version`, `generate`, `resolve`, `apply`, `progress`. `generate` takes
`baseText` or `baseGit` and answers `baseSpec`; `resolve`/`apply` take `baseText`.
`params.path` must be absolute.

### Protocol 3

hatch 0.3.0; `protocolMin` 2 — a client written for protocol 2 works unchanged.

- `resolve` and `apply` take `baseGit` as `generate` does, and answer `baseSpec`.
- `version` announces `protocolMin` and `configSchemaMin`.
- `languages` includes every file extension without its dot.
- `generate` writes the language's own name into `# match`, however the language was
  named.
- `baseGit.branch` finds a branch that shares its name with a tag; a `branch` or
  `commit` starting with `-` is refused with a `GitError` that says why (it was refused
  before as well, with a message about something else).
- An empty `language` is the same as none, in `generate` as in `resolve`/`apply`
  (`generate` used to answer a `ConfigError`).
- In a CRLF base, `resolve`/`apply` write patch lines with CRLF. A fix: the old mixed
  line endings were the bug.
