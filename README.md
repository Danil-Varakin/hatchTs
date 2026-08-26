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

## Usage

```bash
# apply
npm run apply -- --match changes.md --in src/main.cpp --out src/main.cpp

# generate
npm run generate -- --in new.cpp --in-old old.cpp --out changes.md

# ...or take the old version from a git branch
npm run generate -- --in src/main.cpp --branch master --out changes.md
```

Both commands are plain `.ts` entry points, so they can also be run directly:

```bash
node --experimental-strip-types src/cli/apply.ts --match changes.md --in src/main.cpp --out src/main.cpp
```

### `apply` options
```
--match, -m <file.md>   patch instructions (match/patch hunks)   [required]
--in,    -i <file>      source file to patch                     [required]
--out,   -o <file>      where to write the result   [required unless --dry-run/--verify]
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
--help,  -h             this help
```

### `generate` options
```
--in,     -i <file>     new version of the file                    [required]
--in-old     <file>     old version (from a file)      [one of --in-old/--branch]
--branch, -b <branch>   old version = <branch>:<--in path> (git)
--out,    -o <path>     where to write the .md. A file path is taken as is; a
                        directory (existing, or ending with a slash) gets
                        <name of --in>.md inside it; omitted means next to
                        --in. `-` writes to stdout
--language,-l <lang>    force language (else: extension of --in)
--agreement,-a          confirm each hunk before writing
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
--help,   -h            this help
```

#### Anchoring options (how much context a hunk carries)
```
--parents <n|all>       cap on climbing up: at most n enclosing blocks per
                        pattern (default: all)
--min-parents <n>       enclosing blocks EVERY pattern carries (1)
--parent-detail <n>     bracket levels spelled out in parent headers, counting
                        from the outermost: 0 gives `foo( ... )`, 1 gives
                        `foo(bar( ... ))` (0)
--min-siblings <n>      neighbouring significant lines EVERY pattern carries,
                        per side (1)
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
for **upwards from `--in`** (like eslint/prettier). Layers, weakest first:

```
built-in defaults  <  hatch.config.json  <  CLI flags
```

```json
{
  "$schema": "./hatch.config.schema.json",
  "version": 1,
  "generate": {
    "out": "patches/",
    "language": "cpp",
    "exact": false,
    "bridgeGap": 0,
    "parents": {
      "min": 1,
      "max": "all",
      "detail": { "base": 0 },
      "required": false
    },
    "siblings": { "min": 1, "max": 8, "detail": { "base": 0 } }
  }
}
```

`generate.out` is a *place*, not necessarily a name: a directory there gets
`<name of --in>.md` written inside it.

```
--config <file>         use this config instead of searching upwards
--no-config             ignore config files (built-in defaults + flags only)
--print-config          print the effective settings and where each came from
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
bad configuration · `6` grammar missing or failing its checksum · `1` unexpected.

`6` is deliberately its own code: it says the *environment* lacks a grammar (fix:
`npm run grammars`), not that anything is wrong with the patch.

Ambiguity is an **error**, never a silent pick: if a pattern fits in two places
with different results, you get exit `4` and the positions, and the fix is more
context.

## Grammars

Parsing is done by tree-sitter, so every language needs its `.wasm` grammar. They
are **not** kept in the repository — the eleven of them weigh 22 MB, and most runs
need exactly one. Instead each language pins its grammar in its own folder:

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
npm run grammars
```

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

`grammars` is a command like `apply` and `generate` (`src/cli/grammars.ts`), not a
build script: `npm run grammars -- --list` shows what is registered and where each
grammar sits now, `-- --language go` fetches just one, and
`npm run grammars -- --pin <package@version>` prints the block to paste into a new
language's `index.ts`.

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
npm packages by `npm run grammars`.

## Build & run

Sources are `.ts` and run directly on **Node 22+** via type-stripping — no build
step. TypeScript is used only to type-check.

```bash
npm test          # unit + round-trip suites
npm run typecheck # tsc --noEmit over src/ and test/
npm run check     # both
```

Structure analysis uses **tree-sitter** via `web-tree-sitter` (WASM grammars —
cross-platform, no native build); these load once at startup. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and the
reasoning behind the strict tsconfig.
