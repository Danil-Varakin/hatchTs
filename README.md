# Hatch

**Structure-aware semantic patches for source code.** Instead of brittle line
numbers, a Hatch patch describes *where* to change code in terms of the code's
own structure — and the tool finds the spot. A TypeScript port of the original
Python prototype, with a typed AST and an npm-native pipeline (no Python in the
build).

> Русская версия: [README.ru.md](./README.ru.md)
> Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md) · Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Why

Patching a fast-moving upstream codebase with classic `.patch` files breaks
constantly: a few inserted lines upstream and every hunk's line numbers drift.
Hatch describes a change declaratively — "insert this *after that include*,
*inside that function*" — using three operators. The position is resolved against
the parsed structure of the file, so reformatting and unrelated edits upstream
don't invalidate the patch.

Three commands:

- **`apply`** — apply a `.md` instruction file to a source file.
- **`generate`** — diff two versions of a file and emit the `.md` instructions.
- **`grammars`** — put the tree-sitter grammars in place (see Grammars below).

`generate` then `apply` round-trips: applying a generated patch to the old file
reproduces the new file. `generate` guarantees this by construction — it applies
each candidate hunk with the real patcher and keeps only what reproduces the
change.

## The file format

A patch is Markdown made of `match`/`patch` block pairs:

```
# match <language>
    <pattern, one four-space gutter per line>
# end
# patch
    <replacement text, same gutter>
# end
```

Three rules, and they are the whole format:

1. **Column 0 belongs to the structure.** `# match`, `# patch` and `# end` are
   recognized only there.
2. **Every payload line carries a four-space gutter**, which is stripped on read.
   So a payload line can never reach column 0 — a ` ``` ` fence, a `# patch`
   heading or a `# end` inside a raw string is just text. There is no delimiter
   in this format that code could collide with.
3. **`# end` closes a block.** Blank lines inside a block are payload, trailing
   ones included; blank lines between hunks are not. Anything before the first
   `# match` is free-form prose.

A payload line that forgets the gutter is a parse error, never a silent loss.
The one exception worth knowing: a payload line made of *significant trailing
whitespace* is indistinguishable from junk to a whitespace fixer, so don't run
one over an instruction file — `generate` warns when it emits such a line.

Line endings are not payload. An instruction file may reach you with LF or CRLF —
git and editors turn them either way — and both read alike. A patch takes the line
ending of the file it lands in: in a CRLF file every line it writes ends in CRLF, in an
LF file it lands byte for byte. Where a file mixes the two, the line the edit starts on
decides.

## The language: three operators

The `match` block is written in the target language with operators interleaved:

| Operator | Meaning |
|----------|---------|
| `...`    | skip ahead to the next anchor (all occurrences are tried, with backtracking) |
| `>>>`    | insertion point |
| `<<<`    | end of the replacement range (which starts at `>>>`) |

Everything that isn't an operator is a **literal anchor** — a piece of the target
file that must be there. A pattern describes the file **as a whole**: no `...`
before the first literal means "starts at the very beginning of the file", and no
`...` after the last one means "ends at end of file".

Whitespace between literals and operators is insignificant for brace languages,
so the anchors can be copied out of the source and reindented freely. In Python it
is not: the leading indentation of a payload line is part of the anchor, and a
multi-line anchor therefore pins the level of every line it spans. Copy Python
anchors out of the source with their indentation intact.

**Inside a string literal, whitespace is data and it counts.** `Log("a  b")` and
`Log("a b")` are different anchors, and the second will not match the first. The
exception is a MULTI-LINE literal (`R"(…)"`, a docstring, a template literal, a Go
backtick): whitespace inside one still collapses. An anchor is a fragment cut on line
boundaries, so it can begin inside such a literal with no way to know — and levelling
both sides is the only way they can agree.

Operators are recognized only as standalone *words* (whitespace or line edge on
both sides), so `template <typename... Args>` stays literal. A genuine standalone
`...` in code is escaped as `\...`.

## Examples

Insert a call at the end of a function body:

```markdown
# match cpp
    ...
    void RegisterFeatures(FeatureList* list) {
      list->Add(kFastPath);
    >>>
    }
    ...
# end
# patch

      list->Add(kNewPath);
# end
```

Read it as: *skip anything, find that function header, then that call, **insert
here**, and the very next thing must be the closing `}` — then anything to end of
file.* The `}` is not decoration: it is what pins the insertion **inside** this
function (see the third fixed rule below).

Replace a range — everything between `>>>` and `<<<` is old code that must match
and is thrown away:

```markdown
# match cpp
    ...
    namespace content {
    ...
    >>>
    void RegisterFeatures( ... ) {
    <<<
    ...
# end
# patch
    // Registers every content feature.
    void RegisterFeatures( FeatureList* list ) {
# end
```

Note the `...` **inside** the anchor: the balanced innards of a bracket pair can
be skipped, so the anchor survives edits to the argument list. `generate` writes
its anchors this way by default.

## Install

Requirements: **Node.js 22 or newer**; **git** only for reading a version out of a
repository (`--head`, `--branch`, `--commit`, `--repo-path`, the service's `baseGit`).
Linux, macOS and Windows are all tested in CI.

Every release on the [Releases page](https://github.com/Danil-Varakin/hatchTs/releases)
has a `hatch-<version>.tgz` attached; install that archive by its URL:

```bash
npm i -g https://github.com/Danil-Varakin/hatchTs/releases/download/v<version>/hatch-<version>.tgz
```

You get a `hatch` command. The grammars are not inside — they are large, and a run
needs only its own language's — so once after installing:

```bash
hatch grammars
```

From a clone it also works without installing: `npm run hatch -- <command>`.

## Usage

```bash
# apply
hatch apply --match changes.md --in src/main.cpp --out src/main.cpp

# ...or patch the file as git holds it: does the patch still fit master?
hatch apply --match changes.md --in src/main.cpp --branch master --verify

# generate
hatch generate --in new.cpp --in-old old.cpp --out changes.md   # a file: it has an extension

# ...or take the old version from git: the same file, as of the last commit here
hatch generate --in src/main.cpp --head --out changes.md

# a branch (its last commit), a single commit, another path inside the repository
hatch generate --in src/main.cpp --branch master --out changes.md
hatch generate --in src/main.cpp --commit 1f3ac9d --out changes.md
hatch generate --in src/main.cpp --branch master --commit 1f3ac9d \
               --repo-path src/legacy/main.cpp --out changes.md
```

`hatch` with no arguments lists the commands, `hatch <command> --help` shows its
options, `hatch --version` reports the tool version and the config schema version.

Exit codes, for scripts to rely on:
`0` ok · `1` usage or any other refusal · `2` `.md` parse · `3` no match ·
`4` ambiguous · `5` config · `6` grammar (details under "Exit codes" below).

### `apply` options
```
--match, -m <file.md>   patch instructions (match/patch hunks)   [required]
--in,    -i <file>      the file to patch                        [required]
                        read from disk, unless a git coordinate is named
--head,   -H            the file as git holds it — the same four flags, with the
--branch, -b <branch>   same defaults, questions and refusals, as `generate` (see "Where
--commit, -c <commit>   the old version comes from" below)
--repo-path  <path>
--out,   -o <path>      where to write the result   [required unless --dry-run/--verify]
                        same placement rules as `generate --out`, minus
                        mirroring: a directory gets <name of --in> inside it, any
                        other path is written as is, directories are created,
                        `-` writes to stdout
--language, -l <lang>   force language (else: '# match <lang>' in the .md, else
                        the file extension)
--dry-run               show planned edits, write nothing
--verify                exit code only (0 = applies cleanly), write nothing
--download-grammars     allow fetching this language's grammar if it is missing
                        (off by default, see Grammars below)
--log [place]           also write a full log; every run gets its own file, mode
                        0600. A place that is a directory (or ends in /) gets a
                        generated name, otherwise it IS the name; omitted means
                        ./hatch-logs/
--yes,    -y            answer yes in advance to every question (see "When hatch
                        asks before going on" below)
--help,  -h             this help
```

With a git coordinate, `--in` stops being the file's content and becomes its **name**:
it finds the repository, gives the default path inside it, and names the result — so
it need not exist on disk at all. The result is named after `--in` even when
`--repo-path` read another path: patching the version from before a rename and saving
it under the new name is the case this serves.

One rule is `apply`'s own. Writing the result over `--in` itself while the content
came out of git puts a patched git version where your working file is. If that would
lose what the working file holds, you are **asked** first (see "When hatch asks before
going on"). Nothing is asked when nothing is lost: the working file already had the git
text, or the result is the working file itself (a patch generated from it, applied
back). Patching in place from disk is untouched.

The case this is for most is CI: `--verify --branch main` answers "does this patch
still fit main" without checking anything out.

### `generate` options
```
--in,     -i <file>     new version of the file                    [required]
--in-old     <file>     old version, read from this path
--head,   -H            old version from git, every coordinate defaulted:
                        current branch, its last commit, the path of --in
--branch, -b <branch>   which branch (default: the one we are on). Alone it
                        means the last commit of that branch. A BRANCH, local
                        or remote-tracking: a tag or a raw sha belongs in
                        --commit, and here it is asked about first
--commit, -c <commit>   which commit (default: the last one of that branch).
                        Any revision git understands: a sha, a tag, HEAD~3.
                        Alone it is taken as given; together with --branch it
                        should be one that branch holds, or you are asked
--repo-path  <path>     which file, named INSIDE THE REPOSITORY (default: the
                        path of --in). Unlike --in-old, which is a path on
                        disk, this is a path git knows: a relative one is
                        measured from the repository root, never from the
                        current directory
--out,    -o <path>     where to write the .md. A path with no extension (or one
                        ending with a slash, or an existing directory) is a
                        DIRECTORY and gets <name of --in>.md inside it; a path with
                        an extension is the file itself, overwritten. Missing
                        directories are created. A relative path is measured from the
                        repository root, not from the current directory. Omitted
                        means next to --in; `-` writes to stdout
--mirror                keep patches in a tree of their own: the .md goes to
                        <--out>/<path of --in inside the repository>.md, and
                        missing directories are created. Requires --out, which is
                        then always a directory; a relative one is taken from the
                        repository root, never from the current directory
--language,-l <lang>    force language (else: extension of --in)
--agreement,-a          show each hunk as it is made: Enter keeps it; n offers to
                        write the hunks by hand in the editor (see "Writing a hunk
                        by hand"), and refusing that stops the run without a .md.
                        Answers may be piped in, one line per hunk; an input that
                        closes early stops the run without a .md
--exact,  -e            reproduce the new file byte for byte; without it every
                        line only has to match after normalization (indentation
                        and inner spacing are free, the set of lines is not)
--debug,  -v            trace synthesis to stderr: every segment, each probe
                        attempt (incl. non-unique) and the chosen hunk
--download-grammars     allow fetching this language's grammar if it is missing
                        (off by default, see Grammars below)
--log [place]           also write a full log: the resolved config with the origin
                        of every value, and the whole synthesis trace whether or
                        not -v is on. Every run gets its own file, mode 0600;
                        omitted means ./hatch-logs/
--yes,    -y            answer yes in advance to every question (see below)
--help,   -h            this help
```

#### Where the old version comes from

Exactly one source, and the choice is not a list of modes — it is one file on disk
(`--in-old`) or git. From git the version is named by three **independent
coordinates**, and every one of them may be left out; what is missing takes its
default:

| coordinate | flag | left out means |
|---|---|---|
| branch | `--branch` | the branch we are on |
| commit | `--commit` | the last commit of that branch |
| path   | `--repo-path` | the path of `--in` inside the repository |

So all three omitted is "this same file, as of the last commit here" — and since
that names no coordinate at all, it needs a flag of its own to ask for git:
`--head`. Every other combination follows from the table: `--branch master` is the
last commit of `master`, `--commit 1f3ac9d` is that commit of this same file,
`--repo-path` swaps the file without touching which commit it is read from.

A commit names a version on its own, so `--commit 1f3ac9d` is taken as given, wherever
that commit lives. The branch beside it is a **claim about** it — and a claim is worth
checking, which makes `--branch` with `--commit` the one combination that can
contradict itself: a commit the branch never held is asked about before a version out
of another history is read.

Each coordinate is also held to its own kind. `--branch` takes a **branch** (local or
remote-tracking); a tag or a raw sha is asked about, with a pointer to `--commit`,
which takes any revision git understands. `--repo-path` takes a **file**: a directory
is refused rather than handed back as a printed tree listing.

`--in-old` is untouched by all of this — an old version that lives in no repository
is still a path on disk, and always will be. That is also the difference to keep in
mind between the two path flags: `--in-old` is a path your shell can complete,
`--repo-path` is a path git can look up.

#### Writing a hunk by hand

When synthesis cannot anchor a change — two identical places, say — and a person is at
the terminal, `generate` does not simply fail: it says why and offers the editor
(`$VISUAL`, else `$EDITOR`, else `vi` / `notepad`). The editor gets the `.md` so far —
**every** hunk, with a hunk to start from for the change in question and the change
itself quoted on top. Whatever comes back, pattern and patch body alike, is checked: it
has to parse, and every hunk has to land on the old version in order. If it does not,
the reason goes on top and you are asked again, as many times as it takes; say no and
the run stops without a `.md` (the edited file is kept, and its path printed). Once it
stands, synthesis goes on from the text those hunks produce. A patch body edited to
differ from `--in` stays as edited, and the run ends with a warning that the `.md` does
not give `--in`.

With no terminal — a script, CI — the error is the one it always was, with its exit
code.

#### When hatch asks before going on

Some requests git can carry out but that may not say what was meant. Those are
**asked about**, not refused — the warning says what going ahead means, and the answer
decides:

| situation | going ahead means |
|---|---|
| `--commit` is not on the `--branch` named beside it | that commit is read all the same, out of a history the branch never had |
| `--branch` names a tag or a raw sha | it is read as a plain revision, the way `--commit` would |
| `apply` writes over `--in` while its content came out of git, and the file holds changes that version lacks | the patched git version takes its place; whatever of it was not committed is lost |

```
warning: commit 1f3ac9d is not on branch main — going ahead reads that commit all the
same, out of a history branch main never had
  go ahead? [y/N]
```

The default is **no**. `--yes` / `-y` answers yes in advance, for scripts. With no
terminal to answer — a pipe, CI — the answer is no and the run stops, saying that
`--yes` would have gone on. A run nobody watches must not be the one that quietly
throws work away.

What git cannot carry out at all — a branch, commit or file that is not there, a
directory where a file goes, git not runnable — is never a question: there is nothing
to go ahead with, and `--yes` does not change that.

#### Anchoring options (how much context a hunk carries)
```
--parents <n|all>       cap on climbing up: at most n enclosing blocks per
                        pattern (default: all)
--min-parents <n>       enclosing blocks EVERY pattern carries (1)
--parent-detail <n>     bracket levels spelled out in parent headers, counting
                        from the outermost: 0 gives `foo( ... )`, 1 gives
                        `foo(bar( ... ))` (0)
--min-siblings <n>      neighbouring significant lines EVERY pattern carries,
                        per side (0)
--siblings <n>          cap of neighbouring significant lines per side (8);
                        0 forbids leaning on neighbours at all
--sibling-detail <n>        same bracket baseline for neighbour anchors (0)
--require-parents       never fall back to a parentless pattern: fail instead
--bridge-gap <n>        stitch edits split by up to n unchanged non-blank
                        lines back into a single hunk (0)
```

These trade the two failure modes against each other. More parents and fewer
siblings make an anchor **structural**: it survives neighbouring lines being
edited by someone else's commit, because an unclosed `{` orders the walk and its
closer keeps the edit inside that block. Fewer parents and more siblings make a
shorter, more literal anchor that reads better but drifts. Ambiguity is answered
by *detail* first — and there is no unfolding ceiling: the ladder spells out ONE
bracket at a time, the one that actually cuts down the places the anchor can start,
and stops as soon as no bracket helps. Only then does it reach for
neighbours.

`detail.base` is the readability knob: raising it keeps outer brackets spelled
out in every hunk. It costs drift-tolerance, not correctness — a longer anchor is
*more* specific, so uniqueness never suffers. That trade cannot be measured from
one pair of file versions, which is why it is policy rather than automatic.

### Configuration

Anything above can be pinned as project policy in `hatch.config.json`, searched
for **upwards from `--in`** — but only within the project: the walk stops at the
repository root (the directory holding `.git`) and never climbs into your home
directory. A config one level above the repo is not policy you agreed to, and
nothing in the output would tell you it applied. Layers, weakest first:

```
built-in defaults  <  hatch.config.json  <  CLI flags
```

```json
{
  "$schema": "https://raw.githubusercontent.com/Danil-Varakin/hatchTs/main/hatch.config.schema.json",
  "version": 1,
  "generate": {
    "language": "cpp",
    "exact": false,
    "bridgeGap": 0,
    "parents": {
      "min": 1,
      "max": "all",
      "detail": { "base": 0 },
      "required": false
    },
    "siblings": { "min": 1, "max": 8, "detail": { "base": 0 } },
    "out": "patches",
    "mirror": true
  }
}
```

`$schema` is for editors only: it gives completion and checking while you type. The
schema is also in the SchemaStore catalog's format (`.github/schemastore/`), and once it
is listed there VS Code and JetBrains pick it up by the file name, without the line.
hatch itself never reads `$schema` — it checks the whole file on every run and names
any key it does not know.

`generate.out` is a *place*, not necessarily a name. A value with **no extension** — or
one ending with a slash, or naming a directory that is already there — is a directory, and
`<name of --in>.md` is written inside it; a value with an extension is the file itself.
Missing directories are created, and a file sitting where one of them has to go is
reported by name rather than as `EEXIST … mkdir`. A relative value is measured from the **repository root**, never
from the current directory — the same settings must mean the same place in a terminal, in
an editor whose working directory is nobody's business, and in CI. Outside a repository
the fallback is the directory of the file being patched. `apply --out` follows the same
rules.

`generate.mirror` changes that place into a tree. With it on, the patch for
`chromium_src/browser/core/apdate.cc` goes to
`<out>/chromium_src/browser/core/apdate.cc.md`, missing directories are created, and
`out` is required and always read as a directory.

Paths are measured from the **repository root** — the nearest ancestor holding `.git`,
the same boundary the config search stops at. A file outside any repository is an error,
not a guess, so mirrored patches can never land somewhere unrelated. A relative `out` is
taken from that root as well, so running `hatch generate` from different directories
writes to the same place.

```
--config <file>         use this config instead of searching upwards; an
                        explicit path is bounded by nothing, so this is how one
                        config is shared by several repositories
--no-config             ignore config files (built-in defaults + flags only)
--print-config          print the effective settings, the file they came from,
                        and the origin of each value
```

Only the **generate** side is configurable. A `.md` patch is a public contract
and must mean the same thing on every machine, so nothing that changes how
`apply` reads an existing patch is ever put in a config file — such things
belong inside the `.md` itself. An unknown key is an error (exit `5`), not a
silent default.

When a patch won't apply, `--debug` on `generate` is the fastest way to see how
the anchors were chosen; `--dry-run` on `apply` shows the exact edits without
touching the file.

### Exit codes (for CI)
`0` success · `2` parse error · `3` no match (reports the deepest point the
pattern reached) · `4` ambiguous match (reports the competing positions) · `5`
bad configuration · `6` grammar missing or failing its checksum · `1` everything
else: a wrong invocation, a missing file, a git refusal, an unknown language, a
question answered no, or an unexpected failure.

`6` is deliberately its own code: it says the *environment* lacks a grammar (fix:
`hatch grammars`), not that anything is wrong with the patch.

Ambiguity is an **error**, never a silent pick: if a pattern fits in two places
with different results, you get exit `4` and the positions, and the fix is more
context.

## API

```ts
import { applyAll, synthesize, parseHatchFile, printHatchFile, adapterForLanguage } from 'hatch';

const adapter = adapterForLanguage('cpp');
await adapter.init();

const { source, edits } = applyAll(oldCode, parseHatchFile(md), adapter);
const md2 = printHatchFile(synthesize(oldCode, newCode, adapter), 'cpp');
```

### Functions

| | |
|---|---|
| `applyAll(source, file, adapter)` | applies hunks in order; returns `{ source, edits }`. Throws `MatchError` or `AmbiguityError` on the first hunk that does not fit |
| `synthesize(old, new, adapter, options?)` | produces `Hunk[]` from two versions of a file |
| `parseHatchFile(text)` | `.md` → `HatchFile` |
| `printHatchFile(hunks, language?)` | `Hunk[]` → `.md` |
| `trailingSpaceWarnings(hunks)` | patch-body lines that end in significant whitespace |
| `adapterForLanguage(name)` | adapter by language name |
| `adapterForFile(path)` | adapter by file extension |
| `supportedLanguages` | names and aliases in the registry |

`adapter.init()` is called once and loads the grammar; `buildMap` is synchronous
afterwards.

### Errors

`HatchError` is the base class. Each subclass carries an `exitCode` matching the CLI:
`ParseError` (2), `MatchError` (3), `AmbiguityError` (4), `ConfigError` (5),
`GrammarError` (6).

### Types

`HatchFile`, `Hunk`, `MatchPattern`, `LanguageAdapter`, `ApplyResult`, `AppliedEdit`,
`SynthOptions`, `SynthEvent`, `Tracer`.

### Boundaries

Only the above is exported. The matcher, patcher, canonicalizer, source map, `infra/`
and the contents of the language folders are internal and change without notice;
sub-paths (`hatch/dist/...`) are closed off by the `exports` field.

`LanguageAdapter` is available as a type: adapters are obtained from the registry and
handed back. Writing your own adapter is not supported.

## Service: hatch for an editor

`node node_modules/hatch/dist/service/index.js` runs hatch as a long-lived process that
speaks JSON over stdio: `generate`, `resolve` and `apply` on text instead of files, and
coordinates of every hunk in the base and in the patched text. It is what the VS Code
extension talks to. The contract, and how its version is checked, is in
[PROTOCOL.md](./PROTOCOL.md); the types are published as `hatch/protocol`.

## Grammars

Parsing is done by tree-sitter, so every language needs its `.wasm` grammar. They
are **not** kept in the repository — together they weigh tens of megabytes, and most
runs need exactly one. Instead each language pins its grammar in its own folder:

```ts
grammar: {
  file: 'tree-sitter-go.wasm',
  package: 'tree-sitter-go',
  version: '0.25.0',
  sha256: '9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7',
},
```

Fetch them once — this is the only command that goes to the network on purpose:

```bash
hatch grammars
```

`hatch grammars --language <lang>` fetches just one, `--list` shows what is
registered and where each grammar sits now, and `--pin <package@version>` downloads a
grammar and prints the declaration block to paste into a new language folder.

Grammars land in a shared user cache (`~/.cache/hatch/grammars`, or the platform
equivalent), so other checkouts reuse them.

**Nothing is downloaded behind your back.** A `.wasm` is executable code, so a
missing grammar is an error (exit `6`) naming the command that fixes it. To let a
single run fetch what it needs, say so: `--download-grammars`, or
`HATCH_GRAMMARS_DOWNLOAD=1` for CI. When it does download, the version is exact,
the transport is https, and the bytes must match the pinned sha256 — a mismatch
fails the run rather than falling back to another mirror.

| Variable | Effect |
|---|---|
| `HATCH_GRAMMAR_DIR` | look here first — air-gapped builds, custom grammar builds |
| `HATCH_GRAMMAR_CACHE` | where downloads are cached |
| `HATCH_GRAMMARS_DOWNLOAD=1` | permission to download, for CI |

`grammars` is a command like `apply` and `generate`, not a build script:
`hatch grammars --list` shows what is registered and where each grammar sits now,
`--language go` fetches just one, and `--pin <package@version>` prints the block to
paste into a new language's `index.ts`.

## Three rules fixed by decision (not derivable from syntax)

These are intentional and stable; patches rely on them:

1. **`<<<` replaces *inclusively*.** Literals between `>>>` and `<<<` are "old
   code": they must match but are not emitted — the patch body takes their place.
   Literals *outside* the markers are context and are preserved.
2. **A pattern describes the whole file.** `...` is the only way to skip. A
   missing leading `...` means the first anchor sits at offset 0; a missing
   trailing `...` means the last anchor ends at EOF.
3. **An unclosed `{` orders, it does not lock.** Matching an opening brace only
   means "the next anchor comes after it" — the search still runs to end of file,
   and leaving the block is legal. To keep an edit *inside* a construct you must
   write that construct's closing token in the pattern. This is why `generate`
   emits both the header of an enclosing function and its `}`.

## Known limitations

What hatch does not do, on purpose or not yet — worth knowing before you rely on it:

- **Identical code with identical context cannot be told apart.** The pattern
  language has no "the n-th occurrence": when two places match word for word, their
  neighbours included, `generate` reports ambiguity and `apply` exits `4`. Write that
  anchor by hand, leaning on code that differs — often what comes *after* the edit.
- **"Already applied" is not recognized.** Applying a patch a second time, or to the
  wrong file, both end in exit `3`: telling the two apart is the calling pipeline's
  job, not hatch's.
- **Line endings belong to the file, not to the patch.** A patch writes its lines
  with the ending of the line the edit starts on, so a patch cannot convert CRLF lines
  to LF (or back) where it starts on a CRLF line.
- **Git with `core.autocrlf=true`** (the Git for Windows default): a version read out
  of git has the line endings the repository stores (LF), while the file on disk has
  CRLF, so `generate --head` sees every line as changed. Set `core.autocrlf false` for
  the repository (Chromium's Windows setup does), or pass the old version with
  `--in-old`.
- **Large files full of near-identical code make `generate` slow** — seconds to minutes
  where one pattern has to be tried against many look-alike places.
- **Writing a file keeps its permission bits and writes through symlinks**, but not its
  owner, ACLs or extended attributes, and a hard link to it is split off — the write
  goes through a temp file and a rename, so that a run cut short never leaves half a file.
- **Whitespace inside a multi-line string literal is not significant** (see "The
  language"), and `.mm` is read with the Objective-C grammar (see "Language support").

## Language support

The languages Chromium is written in:

| Language | Extensions | Heading / `--language` |
|----------|-----------|------------------------|
| C++ | `.cc` `.cpp` `.cxx` `.h` `.hpp` `.inc` | `cpp`, `c++`, `cc`, `cxx`, `h`, `hpp` |
| C | `.c` | `c` |
| Objective-C | `.m` `.mm` | `objc`, `objective-c` |
| Python | `.py` `.pyi` | `python`, `py` |
| JavaScript (incl. JSX) | `.js` `.mjs` `.cjs` `.jsx` | `javascript`, `js`, `jsx` |
| TypeScript | `.ts` `.mts` `.cts` | `typescript`, `ts` |
| TSX | `.tsx` | `tsx` |
| Rust | `.rs` | `rust`, `rs` |
| Java | `.java` | `java` |
| Kotlin | `.kt` `.kts` | `kotlin`, `kt` |
| Go | `.go` | `go`, `golang` |

`generate` writes the language's own name into the heading — the first name in the
last column (`cpp`, `objc`, `python`), however the language was picked. Every
extension in the table, without its dot, is a name as well: hatch 0.2.0 and earlier
wrote that (`# match mm`), and such a `.md` applies the same.

Structure comes from tree-sitter, so preprocessor branches, raw strings, macros
and generics (`Map<K, V>` is a bracket pair, `a < b` is not) don't confuse the
pairing. `.h` is C++ by Chromium convention. `.mm` is Objective-C++, which no
tree-sitter grammar covers fully — the Objective-C grammar handles it best and
degrades to plain text matching on the C++-only parts.

### Adding a language: the one-folder rule

**A language is one folder under `src/lang/` and one `index.ts` inside it, holding
all of its rules — the grammar to load, the extensions it claims, how nesting is
balanced (`blockOf`) and how literal text is canonicalized (`normalize`). Rules are
never lifted out into a module shared between languages, not even when two
languages would spell them identically.**

What that buys: to add a language you copy one folder and edit one file, knowing
nothing about the others and touching none of them. The apparent duplication is
the price, and it is deliberate — the rules do diverge in practice (the bracket
pairs of C, Go, JavaScript and Python already differ, and Kotlin needs its own
notion of where a block's header starts). A shared "C-like rules" module would
turn every one of those into a flag.

Only language-*neutral* machinery is common — grammar loading, tree walking,
canonicalization plumbing, map building — because a language does not get to
choose it. The one shared file an addition touches is the adapter registry, and
only because that whitelist has to be a static list: a language name arrives from
an untrusted `.md`, so it must never become a dynamic import.

Nothing in `src/core/` changes either; that is the other test of the boundary, and
none of the languages above needed an exception. Python is the odd one out among
them — significant indentation, so its own canonicalizer and its own notion of a
block, where the opening token is the colon.

Grammars live in `grammars/*.wasm` and are copied from the official tree-sitter
npm packages by `hatch grammars`.

## Build & run

Sources are `.ts` and run directly on **Node 22+** via type-stripping, so development
needs no build step. The published package is built (`npm run build` → `dist/`), and
that build is what `npm pack` puts in the tarball.

```bash
npm test          # unit, round-trip and golden suites
npm run typecheck # tsc --noEmit over src/ and test/
npm run check     # both
npm run build     # dist/, for the package only
```

Structure analysis uses **tree-sitter** via `web-tree-sitter` (WASM grammars —
cross-platform, no native build); these load once at startup. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and the
reasoning behind the strict tsconfig.
