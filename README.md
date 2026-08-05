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

Two commands:

- **`apply`** — apply a `.md` instruction file to a source file.
- **`generate`** — diff two versions of a file and emit the `.md` instructions.

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

Whitespace between literals and operators is insignificant for C-like languages,
so the anchors can be copied out of the source and reindented freely.

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
--help,  -h             this help
```

### `generate` options
```
--in,     -i <file>     new version of the file                    [required]
--in-old     <file>     old version (from a file)      [one of --in-old/--branch]
--branch, -b <branch>   old version = <branch>:<--in path> (git)
--out,    -o <file>     write .md here (default: stdout)
--language,-l <lang>    force language (else: extension of --in)
--agreement,-a          confirm each hunk before writing
--exact,  -e            reproduce the new file byte for byte; without it every
                        line only has to match after normalization (indentation
                        and inner spacing are free, the set of lines is not)
--debug,  -v            trace synthesis to stderr: every segment, each probe
                        attempt (incl. non-unique) and the chosen hunk
--help,   -h            this help
```

When a patch won't apply, `--debug` on `generate` is the fastest way to see how
the anchors were chosen; `--dry-run` on `apply` shows the exact edits without
touching the file.

### Exit codes (for CI)
`0` success · `2` parse error · `3` no match (reports the deepest point the
pattern reached) · `4` ambiguous match (reports the competing positions) · `1`
unexpected.

Ambiguity is an **error**, never a silent pick: if a pattern fits in two places
with different results, you get exit `4` and the positions, and the fix is more
context.

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

C++ / C-like today: `.cc`, `.cpp`, `.cxx`, `.h`, `.hpp`, `.inc`, and the heading /
`--language` names `cpp`, `c++`, `cc`, `cxx`, `c`, `h`, `hpp`. Structure comes
from tree-sitter, so preprocessor branches, raw strings and macros don't confuse
the brace pairing.

A language is one folder under `src/lang/` implementing two things — how nesting
is balanced (`buildMap`) and how literal text is canonicalized (`normalize`).
Nothing in `src/core/` changes. A Python canonicalizer
(`src/lang/python/normalize.ts`) is in the tree; the Python structure provider is
not wired into the adapter registry yet.

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
