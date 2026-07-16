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
*before the namespace*" — using six operators. The position is resolved against
the parsed structure of the file, so reformatting and unrelated edits upstream
don't invalidate the patch.

Two commands:

- **`apply`** — apply a `.md` instruction file to a source file.
- **`generate`** — diff two versions of a file and emit the `.md` instructions.

`generate` then `apply` round-trips: applying a generated patch to the old file
reproduces the new file.

## The language: six operators

A patch is Markdown containing `match`/`patch` block pairs. The `match` block is
written in the target language with operators interleaved:

| Operator | Meaning |
|----------|---------|
| `...`    | skip a balanced span up to the next anchor (tries all occurrences, with backtracking) |
| `>>>`    | insertion point |
| `<<<`    | end of replacement range (from `>>>`) |
| `^..`    | skip to the **first** occurrence of the anchor |
| `..^`    | skip to the **last** occurrence |
| `^n..`   | skip to the **n-th** occurrence (1-based) |

Operators are recognized only as standalone *words* (whitespace or line edge on
both sides), so `template <typename... Args>` stays literal. A genuine `...` in
code is escaped as `\...`.

## Example

Insert `#include "base/feature_override.h"` right after an existing include,
before the standard-library includes (`content/common/features.cc`):

````markdown
### match
```cpp
...
// found in the LICENSE file.
 #include "content/common/features.h"

 >>>
#include "base/feature_list.h"

 ...
```
### patch
```cpp
#include "base/feature_override.h"
#include "build/build_config.h"
```
````

Read it as: *skip anything, find the LICENSE line, then the `features.h` include
immediately after it, **insert here**, the `feature_list.h` include must follow,
then anything to end of file.* More worked examples (nested namespaces, inserting
a method after another method's closing brace) live in the test fixtures.

## Usage

```bash
# apply
hatch apply --match changes.md --in src/main.cpp --out src/main.cpp

# generate
hatch generate --in new.cpp --in-old old.cpp --out changes.md
# ...or compare against a git branch
hatch generate --in src/main.cpp --branch master --out changes.md
```

### `apply` options
```
--match <file>     path to the .md with match/patch blocks
--patch <file>     separate patch file (optional)
--in <file>        input source file
--out <file>       output file
--language <lang>  cpp | python (auto-detected from extension if omitted)
--dry-run          show the edits, write nothing
--verify           check applicability only; exit code for CI
```

### `generate` options
```
--in <file>        the new version of the file
--in-old <file>    the old version
--branch <branch>  git branch to compare against (default: master)
--language <lang>  cpp | python (auto-detected if omitted)
-a, --agreement    confirm each match interactively
```

### Exit codes (for CI)
`0` success · `2` parse error · `3` no match (reports the deepest failure point)
· `4` ambiguous match (reports the competing positions) · `5` already applied
(idempotency) · `1` unexpected.

## Three rules fixed by decision (not derivable from syntax)

These are intentional and stable; patches rely on them:

1. **`^n..` is 1-based.** `^1..` ≡ `^..`.
2. **`<<<` replaces *inclusively*.** Literals between `>>>` and `<<<` are "old
   code": they must match but are not emitted — the patch body takes their place.
   Literals *outside* the markers are context and are preserved.
3. **Region closing differs by language.** In C++ a region is closed by a literal
   `}`. In Python there is no closing token — the end of a region is expressed by
   an anchor literal at an outer indent, or implicitly by `...` reaching a
   shallower-indented line.

## Status

This is an in-progress port. Done and tested: the language-neutral parsing core
(`src/core/` — AST, errors, single-pass parser, printer) and the C++ literal
canonicalizer (`src/lang/cpp/normalize.ts`), all green under a strict tsconfig.
In progress: the C++ `SourceMap` (tree-sitter-based, plus the shared canonical
mapping), the matcher/patcher, the `generate` pipeline, and the Python adapter.
See [docs/structure.md](./docs/structure.md) for the per-module status and the
[docs/phase-*.md](./docs) plan.

## Build & run

Sources are `.ts` and run directly on **Node 22+** via type-stripping — no build
step. TypeScript is used only to type-check.

```bash
node --experimental-strip-types src/cli/index.ts apply --match ... --in ...
npx tsc -p tsconfig.json   # type-check only (noEmit)
```

Structure analysis uses **tree-sitter** via `web-tree-sitter` (WASM grammars —
cross-platform, no native build); these load once at startup. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and the
reasoning behind the strict tsconfig.

