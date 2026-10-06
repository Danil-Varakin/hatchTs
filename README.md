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

Four commands:

- **`apply`** — apply a `.hatch` instruction file to a source file.
- **`generate`** — diff two versions of a file and emit the `.hatch` instructions.
- **`grammars`** — put the tree-sitter grammars in place (see Grammars below).
- **`init`** — write a `hatch.config.json` (see Configuration below).

`generate` then `apply` round-trips: applying a generated patch to the old file
reproduces the new file. `generate` guarantees this by construction — it applies
each candidate hunk with the real patcher and keeps only what reproduces the
change.

## The file format

A patch is a `.hatch` file: a header, then `match`/`patch` block pairs:

```
Hatch: 1
Target: src/a.cc
Generated-From: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
Generated-By: hatch 0.4.0
Grammar: tree-sitter-cpp@0.23.4

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

The header is `Name: value` lines up to the first blank line, as in a Debian patch.
`Hatch` — the format number — comes first; `Target` is the file the patch is for, from
the repository root; `Generated-From` the git blob it was made against; `Generated-By`
and `Grammar` what made it. `generate` writes them; `apply` checks only `Hatch` (a
patch newer than this hatch is refused with "update hatch") and `Target` (no `..`, not
absolute). Fields hatch does not know are read past.

The fields have fixed places, in this order:

| # | field | written | |
|---|---|---|---|
| 1 | `Hatch` | always | format number, always line 1 |
| 2 | `Target` | when the patch has a place | the file, from the repository root, with `/` |
| 3 | `Generated-From` | when the base came out of git | the git blob of the base |
| 4 | `Generated-By` | always | `hatch <version>` |
| 5 | `Grammar` | always | `<package>@<version>` |

A field left out keeps the rest in order; a known field out of order, or named twice,
is a parse error. Fields hatch does not know may stand anywhere after `Hatch`. A new
field is only ever added at the end of this list (VERSIONING.md H4), so every header
an older hatch wrote reads the same in a newer one. A file with no header — a patch
written by hand — is format 1. hatch 0.3 and older wrote `.md`: rename such a patch
(`git mv x.md x.hatch`) — the hunks are the same.

A hunk may carry a comment: a `# note` … `# end` block right before its `# match`.
The note is prose, in any column, without a gutter, and only people read it — the
matcher never does; over the service it comes back as the hunk's `note`. Text between
hunks outside a note is a parse error. `generate` never writes notes: rerunning it
over a `.hatch` replaces the notes along with the rest.

```
# note
WAIT: without it the driver hangs on a full buffer.
# end
# match c
    ...
```

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

You get a `hatch` command, with the tree-sitter grammars of every language inside it:
nothing to fetch afterwards, and nothing is ever downloaded.

From a clone it also works without installing: `npm run hatch -- <command>`.

## Usage

```bash
# apply
hatch apply --match changes.hatch --in src/main.cpp --out src/main.cpp

# ...or patch the file as git holds it: does the patch still fit master?
hatch apply --match changes.hatch --in src/main.cpp --branch master --verify

# generate
hatch generate --in new.cpp --in-old old.cpp --out changes.hatch   # a file: it has an extension

# ...or take the old version from git: the same file, as of the last commit here
hatch generate --in src/main.cpp --head --out changes.hatch

# a branch (its last commit), a single commit, another path inside the repository
hatch generate --in src/main.cpp --branch master --out changes.hatch
hatch generate --in src/main.cpp --commit 1f3ac9d --out changes.hatch
hatch generate --in src/main.cpp --branch master --commit 1f3ac9d \
               --repo-path src/legacy/main.cpp --out changes.hatch

# a hatch.config.json at the root of the repository
hatch init
```

`hatch` with no arguments lists the commands, `hatch <command> --help` shows its
options, `hatch --version` reports the tool version and the config schema version.

Exit codes, for scripts to rely on:
`0` ok · `1` usage or any other refusal · `2` `.hatch` parse · `3` no match ·
`4` ambiguous · `5` config · `6` grammar · `7` no changes · `8` cannot anchor (details
under "Exit codes" below).

### `apply` options
```
--match, -m <file.hatch>   patch instructions (match/patch hunks)   [required]
--in,    -i <file>      the file to patch                        [required]
                        read from disk, unless a git coordinate is named
--head,   -H            the file as git holds it — the same four flags, with the
--branch, -b <branch>   same defaults, questions and refusals, as `generate` (see "Where
--commit, -c <commit>   the old version comes from" below)
--repo-path  <path>
--out,   -o <path>      where to write the result   [required unless --dry-run/--verify]
                        same placement rules as `generate --out`, minus
                        the upstream tree: a directory gets <name of --in> inside it, any
                        other path is written as is, directories are created,
                        `-` writes to stdout
--language, -l <lang>   force language (else: '# match <lang>' in the .hatch, else
                        the file extension)
--dry-run               show planned edits, write nothing
--verify                exit code only (0 = applies cleanly), write nothing. Checked
                        against a clean base out of git — the flags above, else
                        generate.base; with neither, a terminal is asked whether
                        the files on disk are that base, and without one it is
                        refused
--base-from-disk        --verify against the files on disk, without asking
--config <file>         the config instead of the one up from the patch;
--no-config             none (then --in is required)
--download-grammars     does nothing since 0.4 — grammars ship inside hatch — and
                        warns; removed in 0.5
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
back). Patching in place from disk is untouched. A file that already holds the result
is not written at all (`already so: not written`): it keeps its mtime, and a build does
not recompile it.

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
--eol <repository|worktree>
                        the line endings of what is read from git: as git stores
                        it (default), or as the file of --in on disk has them —
                        for core.autocrlf (generate.base.eol in the config)
--out,    -o <path>     where to write the .hatch. A path with no extension (or one
                        ending with a slash, or an existing directory) is a
                        DIRECTORY and gets <name of --in>.hatch inside it; a path with
                        an extension is the file itself, overwritten. Missing
                        directories are created. A relative path is measured from the
                        repository root, not from the current directory. Omitted
                        means next to --in; `-` writes to stdout
--language,-l <lang>    force language (else: extension of --in)
--agreement,-a          show each hunk as it is made: Enter keeps it; n offers to
                        write the hunks by hand in the editor (see "Writing a hunk
                        by hand"), and refusing that stops the run without a .hatch.
                        Answers may be piped in, one line per hunk; an input that
                        closes early stops the run without a .hatch
--exact,  -e            reproduce the new file byte for byte; without it every
                        line only has to match after normalization (indentation
                        and inner spacing are free, the set of lines is not)
--debug,  -v            trace synthesis to stderr: every segment, each probe
                        attempt (incl. non-unique) and the chosen hunk
--download-grammars     does nothing since 0.4 — grammars ship inside hatch — and
                        warns; removed in 0.5
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
(`$VISUAL`, else `$EDITOR`, else `vi` / `notepad`). The editor gets the `.hatch` so far —
**every** hunk, with a hunk to start from for the change in question and the change
itself quoted on top. Whatever comes back, pattern and patch body alike, is checked: it
has to parse, and every hunk has to land on the old version in order. If it does not,
the reason goes on top and you are asked again, as many times as it takes; say no and
the run stops without a `.hatch` (the edited file is kept, and its path printed). Once it
stands, synthesis goes on from the text those hunks produce. A patch body edited to
differ from `--in` stays as edited, and the run ends with a warning that the `.hatch` does
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
nothing in the output would tell you it applied. When that walk finds nothing, the
config is one that **claims** the file — its `"upstream"` holds it (see "A project over
somebody else's code" below) — then `$HATCH_CONFIG`, then the config in the current
directory if it claims the file. `--config` comes before all of it. Layers, weakest
first:

```
built-in defaults  <  hatch.config.json  <  CLI flags
```

`hatch init` writes one: only `"$schema"` and `"version"`, so every default stays the
built-in one until you set it.

| option | |
|---|---|
| `--config-version <n>` | the config schema to write; default the newest this hatch reads (`hatch --version`). An older one is said so on stderr |
| `--dir <dir>` | where to write; default the git repository root around the current directory, outside a repository the directory itself |
| `--upstream <path>` | the project patches code it does not own: writes `"upstream"` (from the config's directory) and `generate.out` (`--out`, default `patches`); an upstream that is not there is refused |
| `--force` | replace an existing `hatch.config.json` — without it the file is left as it is and hatch exits with 5 |
| `--dry-run` | print the file to stdout, write nothing |

`"$schema"` names the JSON Schema of that very version,
`schemas/hatch.config.v<N>.schema.json`: an editor checks a v1 file against v1, not
against whatever is newest. A file is held to the keys of the version it names.

#### Writing a config

The file is plain JSON — no comments, no trailing commas. Write only what you want to
differ from the default: a key left out keeps the built-in value, and a later hatch that
improves that default reaches your project. Every key, with the flag that overrides it
for one run:

| key | value | default | flag | what it does |
|---|---|---|---|---|
| `$schema` | URL | — | — | for editors only: completion and checking while you type. hatch never reads it |
| `version` | `2` | the newest this hatch reads | — | the config schema the file is written for. Write it: a file is checked against the keys of its version |
| `upstream` | path or `null` | `null` | `init --upstream` | the root of code the project patches but does not own, **from the config's directory**. With it `generate.out` must be a directory, and the patch tree repeats the path of each file from that root (see "A project over somebody else's code") |
| `generate.out` | path or `null` | `null` — next to `--in` | `--out` | where the `.hatch` goes. A directory (`patches`, `patches/`) gets `<name of --in>.hatch`; a name ending in `.hatch` is the file itself; anything else is refused. Relative — from the repository root |
| `generate.language` | language name or `null` | `null` — by the extension of `--in` | `--language` | for files whose extension says nothing, or says the wrong thing (`.h` holding C) |
| `generate.exact` | `true` / `false` | `false` | `--exact` | reproduce the new file byte for byte. Without it indentation and inner spacing are free, the set of lines is not |
| `generate.bridgeGap` | 0–1000 | `0` | `--bridge-gap` | two edits split by up to this many unchanged non-blank lines become one hunk |
| `generate.parents.min` | 0–1000 | `1` | `--min-parents` | enclosing blocks (function, class, namespace) every pattern names. `0` allows a pattern with no structure |
| `generate.parents.max` | 0–1000 or `"all"` | `"all"` | `--parents` | how far up a pattern may climb when it needs more context |
| `generate.parents.detail.base` | 0–1000 | `0` | `--parent-detail` | bracket levels spelled out in those headers, from the outermost: `0` gives `foo( ... )`, `1` gives `foo(bar( ... ))` |
| `generate.parents.required` | `true` / `false` | `false` | `--require-parents` | fail rather than fall back to a pattern with no enclosing block |
| `generate.siblings.min` | 0–1000 | `0` | `--min-siblings` | neighbouring lines every pattern quotes, on each side of the edit |
| `generate.siblings.max` | 0–1000 | `8` | `--siblings` | at most this many neighbours per side; `0` — never lean on neighbours |
| `generate.siblings.detail.base` | 0–1000 | `0` | `--sibling-detail` | as `parents.detail.base`, for neighbour lines |
| `generate.base.head` | `true` / `false` | `false` | `--head` | take the old version from git: the last commit of the branch you are on |
| `generate.base.branch` | branch or `null` | `null` — the current one | `--branch` | the old version is the tip of this branch (local or remote-tracking) |
| `generate.base.commit` | revision or `null` | `null` — the tip | `--commit` | the old version is this commit: a sha, a tag, `HEAD~3` |
| `generate.base.eol` | `"repository"` / `"worktree"` | `"repository"` | `--eol` | line endings of the version read from git: as stored, or as the file on disk has them (`core.autocrlf`) |

Any of `generate.base.head`, `branch` or `commit` asks for git; a git flag on the
command line replaces all three for that run, and `--in-old` ignores them. Numbers are
whole and not negative; a key the schema does not have, or a value of the wrong kind,
stops the run with exit 5 and names the key.

Configs for the usual cases:

```json
{ "version": 2, "generate": { "base": { "head": true } } }
```

Patches next to their files, the old version always the last commit:
`hatch generate --in src/a.cc` writes `src/a.cc.hatch`.

```json
{ "version": 2, "upstream": ".", "generate": { "out": "patches", "base": { "branch": "main" } } }
```

One repository, every patch in a tree of its own, compared with `main`:
`src/net/http.cc` → `patches/src/net/http.cc.hatch`.

```json
{
  "version": 2,
  "generate": {
    "out": "patches/",
    "base": { "head": true, "eol": "worktree" },
    "parents": { "min": 2, "detail": { "base": 1 } },
    "siblings": { "max": 2 }
  }
}
```

Every patch in one flat directory; Windows with `core.autocrlf=true`; anchors that
always name two enclosing blocks with their arguments spelled out and lean on at most two
neighbouring lines — longer patches that survive upstream editing the lines around them.

To see what applies and where each value came from, before generating anything:

```bash
hatch generate --in src/a.cc --print-config
```

`$schema` is for editors only: it gives completion and checking while you type. The
schema is also in the SchemaStore catalog's format (`.github/schemastore/`), and once it
is listed there VS Code and JetBrains pick it up by the file name, without the line.
hatch itself never reads `$schema` — it checks the whole file on every run and names
any key it does not know.

`generate.out` is a *place*, not necessarily a name. A value with **no extension** — or
one ending with a slash, or naming a directory that is already there — is a directory, and
`<name of --in>.hatch` is written inside it; a value with an extension is the file itself.
Missing directories are created, and a file sitting where one of them has to go is
reported by name rather than as `EEXIST … mkdir`. A relative value is measured from the **repository root**, never
from the current directory — the same settings must mean the same place in a terminal, in
an editor whose working directory is nobody's business, and in CI. Outside a repository
the fallback is the directory of the file being patched. `apply --out` follows the same
rules.

A value that names a file must end in `.hatch`; anything else is refused before a
single file is read. What `generate` does with each kind of `--out`:

| `--out` | the patch goes to | `Target` |
|---|---|---|
| not given | next to `--in`: `<in>.hatch` | from the repository root |
| `-` | stdout | — |
| `patches`, `patches/`, an existing directory | `<repository root>/patches/<name of --in>.hatch` | from the repository root |
| `p.hatch`, `deep/p.hatch` | that file, from the repository root | from the repository root |
| `p.md`, `p.txt` | refused, exit 5 | — |
| an absolute path | as above, from `/` | none when the patch is outside the repository |
| with `"upstream"` and a directory | `<config dir>/<out>/<path from the upstream>.hatch` | from the upstream root |
| with `"upstream"` and `-` or no `out` | refused, exit 5 | — |

A place hatch computed that already holds the patch of **another** file (two files with
one name in a flat `out`) is asked about first — `--yes` goes ahead, and with nobody at
a terminal the run stops with exit 5. The same file's patch, and a file named outright
with `--out x.hatch`, are written over.

### A project over somebody else's code

A fork keeps its patches in a repository of its own and patches code it never commits
to. Say the upstream is checked out in `work/`, and the project sits inside it:

```
work/                         the upstream — a repository you do not commit to
├── src/ui/window.cc
├── third_party/zlib/         a repository of its own inside it
└── myfork/                   your project — your repository
    ├── hatch.config.json
    └── patches/
```

`work/myfork/hatch.config.json` says where the code is:

```json
{ "version": 2, "upstream": "..", "generate": { "out": "patches", "base": { "head": true } } }
```

`upstream` is the root of the patched code, **from the config file**. With it the patch
of `work/src/ui/window.cc` is `work/myfork/patches/src/ui/window.cc.hatch`, and its
`Target` is `src/ui/window.cc`. The base comes out of the git repository nearest the
file — `work/third_party/zlib/...` is read from zlib's own repository, with no list of
repositories to keep.

```bash
hatch generate --in work/src/ui/window.cc                   # finds myfork's config
hatch apply --verify --match work/myfork/patches/src/ui/window.cc.hatch
```

The config of a file is found by its claim: up from the file to its repository root
first; then in the immediate subdirectories of every repository root on the way up
(`work/*/hatch.config.json`), and in the directories above the repository. Two configs
that claim one file are an error that names both.

| layout | config | `upstream` |
|---|---|---|
| the project inside the upstream | `work/myfork/hatch.config.json` | `".."` |
| the upstream inside the project | `proj/hatch.config.json`, code in `proj/upstream/` | `"upstream"` |
| beside each other | `ws/proj/hatch.config.json`, code in `ws/upstream/src/` | `"../upstream/src"` — run from `ws/proj`, or pass `--config` / `$HATCH_CONFIG` |
| one repository, patches in a tree of their own | at the repository root | `"."` |
| one repository, a patch next to its file or in one directory | at the repository root | none |

`hatch init --upstream ..` writes such a config. `"upstream": "."` is what
`generate.mirror` used to be.

`generate.base` (schema 2) names the old version once for the project, as `--head`,
`--branch` and `--commit` do for one run: `{ "head": true }` is the last commit here,
`{ "branch": "main" }` the tip of `main`, `{ "commit": "v1.0" }` that tag. With it,
`hatch generate --in <file>` needs no source flag. Any git flag replaces all three for
that run, and `--in-old` ignores them. `generate.base.eol: "worktree"` reads that
version with the line endings of the file on disk (`--eol`), for `core.autocrlf`.

```
--config <file>         use this config instead of searching upwards; an
                        explicit path is bounded by nothing, so this is how one
                        config is shared by several repositories
--no-config             ignore config files (built-in defaults + flags only)
--print-config          print the effective settings, the file they came from,
                        and the origin of each value
```

Only the **generate** side is configurable. A `.hatch` patch is a public contract
and must mean the same thing on every machine, so nothing that changes how
`apply` reads an existing patch is ever put in a config file — such things
belong inside the `.hatch` itself. An unknown key is an error (exit `5`), not a
silent default.

When a patch won't apply, `--debug` on `generate` is the fastest way to see how
the anchors were chosen; `--dry-run` on `apply` shows the exact edits without
touching the file.

### Exit codes (for CI)
`0` success · `2` parse error · `3` no match (reports the deepest point the
pattern reached) · `4` ambiguous match (reports the competing positions) · `5`
bad configuration · `6` grammar missing or failing its checksum · `7` `generate`
found nothing to change — the new version is the old one after normalization (spacing
and blank lines alone are no change), or byte for byte with `--exact` — and wrote no
`.hatch` · `8` `generate` could not anchor a change: no pattern around it lands there and
only there (at a terminal the editor is offered first) · `1` everything
else: a wrong invocation, a missing file, a git refusal, an unknown language, a
question answered no, or an unexpected failure.

`6` is deliberately its own code: it says the *build* lacks a grammar, or holds one that
is not the pinned one (`HATCH_GRAMMAR_DIR`), not that anything is wrong with the patch.

Ambiguity is an **error**, never a silent pick: if a pattern fits in two places
with different results, you get exit `4` and the positions, and the fix is more
context.

## Applying patches in a build: `hatch-apply`

A project's build should not need Node, npm or the network to lay its patches on the
code. Every release carries `hatch-apply` — one executable with Node, the tree-sitter
runtime and every pinned grammar inside — for linux-x64, linux-arm64, darwin-arm64 and
win-x64, and a `SHA256SUMS` beside them. It is the same engine as `hatch apply`: a patch
`generate` made that applies in the editor applies in the build.

```bash
curl -LO https://github.com/Danil-Varakin/hatchTs/releases/download/v0.4.0/hatch-apply-0.4.0-linux-x64
curl -LO https://github.com/Danil-Varakin/hatchTs/releases/download/v0.4.0/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
install -m755 hatch-apply-0.4.0-linux-x64 tools/hatch-apply

tools/hatch-apply verify --match myfork/patches/src/ui/window.cc.hatch
tools/hatch-apply apply  --match myfork/patches/src/ui/window.cc.hatch
```

| | |
|---|---|
| `hatch-apply apply --match <patch> [--out <path>]` | lays the patch on its file — in place without `--out` |
| `hatch-apply verify --match <patch>` | the same, writing nothing: exit 0 when it applies cleanly |
| `hatch-apply --version` | its version, the Node inside, the pin of every grammar |

The file is the one the patch names in `Target`, found through the project's
`hatch.config.json` as `hatch` finds it (`--in` names another). The base is always a
clean one: out of git — `--head` / `--branch` / `--commit`, else `generate.base` of the
config — or, with `--base-from-disk`, the files on disk as they are (and it warns that
it took them so); those must be the clean base, never files a patch was already laid on
(see "Known limitations"). With neither it stops with exit 5. It **never asks**: what `hatch`
would ask about (a tag named as a branch, a commit off the branch named) is refused, and
said. In place, a file that already holds the result is not written again, so the build
does not recompile it; a file with changes of its own — the result of a patch that has
changed since, say — is written over, and said: the code a build patches is not the
project's to keep. Its options are picked out of `hatch apply`'s, each with the same
meaning; it does not generate, serve or download. For a base out of git, `git` must be
on the `PATH`.

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
| `synthesize(old, new, adapter, options?)` | produces `Hunk[]` from two versions of a file. Throws `SynthesisError` when a change cannot be anchored |
| `parseHatchFile(text)` | `.hatch` → `HatchFile` |
| `printHatchFile(hunks, language?)` | `Hunk[]` → `.hatch` |
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

`node node_modules/hatch/dist/bin/service.js` runs hatch as a long-lived process that
speaks JSON over stdio: `generate`, `resolve` and `apply` on text instead of files, and
coordinates of every hunk in the base and in the patched text. It is what the VS Code
extension talks to. The contract, and how its version is checked, is in
[PROTOCOL.md](./PROTOCOL.md); the types are published as `hatch/protocol`.

## Grammars

Parsing is done by tree-sitter, so every language needs its `.wasm` grammar. They
**ship inside hatch** — about 17 MB for all of them, 1.7 MB in the packed archive — and
nothing is downloaded at run time. Each language pins its grammar in its own folder:

```ts
grammar: {
  file: 'tree-sitter-go.wasm',
  package: 'tree-sitter-go',
  version: '0.25.0',
  sha256: '9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7',
},
```

and the bytes must match the pin wherever they are found: a `.wasm` is executable code,
and another grammar can place a hunk elsewhere (F3), so a file with another sha256 fails
the run (exit `6`). A grammar missing altogether is a fault of the build, said so.

| Variable | Effect |
|---|---|
| `HATCH_GRAMMAR_DIR` | look here first — work on the core, a build of one's own; the pin still holds |

The grammars are not in the repository: `npm run grammars`
(`scripts/fetch-grammars.ts`) puts the pinned ones into `grammars/`, and `npm test` and
`npm pack` run it. `node --experimental-strip-types scripts/fetch-grammars.ts --pin
<package@version>` prints the block to paste into a new language's `index.ts`.

Until 0.3 grammars were fetched into a user cache by `hatch grammars` or
`--download-grammars`. In 0.4 both still work, do nothing and say so; they are removed
in 0.5. `HATCH_GRAMMAR_CACHE` and `HATCH_GRAMMARS_DOWNLOAD` no longer do anything.

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
- **"Already applied" is not recognized — the workflow rules it out instead.** hatch
  does not check whether a patch is in the file already: it finds the place and writes.
  Laid a second time on its own result, a patch may lay an insertion again with exit 0
  — `... void g() { ... >>> } ...` still finds the end of `g()`; on the wrong file it
  usually ends in exit `3`. So every run that matters starts from a clean base:
  `apply --verify` and `hatch-apply` read the file out of git (`--head`, `--branch`,
  `--commit` or `generate.base`), and `generate` checks every hunk on the old text it
  was given. Patch the files on disk (`hatch apply` without a git coordinate,
  `--base-from-disk`) only when they are that clean base, never a file already patched.
- **Line endings belong to the file, not to the patch.** A patch writes its lines
  with the ending of the line the edit starts on, so a patch cannot convert CRLF lines
  to LF (or back) where it starts on a CRLF line.
- **Git with `core.autocrlf=true`** (the Git for Windows default): a version read out
  of git has the line endings the repository stores (LF), while the file on disk has
  CRLF, so `generate --head --exact` sees every line as changed. Add `--eol worktree`
  (or `generate.base.eol: "worktree"` in the config) to read it with the endings of the
  file on disk, set `core.autocrlf false` for the repository, or pass the old version
  with `--in-old`.
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
wrote that (`# match mm`), and such a `.hatch` applies the same.

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
an untrusted `.hatch`, so it must never become a dynamic import.

Nothing in `src/core/` changes either; that is the other test of the boundary, and
none of the languages above needed an exception. Python is the odd one out among
them — significant indentation, so its own canonicalizer and its own notion of a
block, where the opening token is the colon.

Grammars live in `grammars/*.wasm`, put there from the official tree-sitter npm packages
by `npm run grammars`, and ship inside the package.

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
