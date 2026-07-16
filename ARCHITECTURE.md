# Architecture

## The one principle that drives everything

**All nesting is balanced once, by the language adapter, during `buildMap`, and
frozen into an immutable `SourceMap`. The matcher never keeps a file-depth stack
and never counts brackets while matching — it queries the prebuilt map like a
reference table.**

Consequences:

- A closing `}` in a pattern resolves to `pair(positionOfItsOpener)` — a jump on
  the map, zero scanning, zero bracket backtracking.
- "Arbitrary nesting" (a target at any depth, through hidden intermediate
  namespaces) works for free: the target is found as an anchor in a window, its
  matching bracket comes from the map. Intermediate levels never participate.
- The matcher keeps only a small stack of *open pattern literals*. Its depth
  equals the number of brackets written in the pattern, independent of the file's
  real nesting.

Contract: **garbage in, garbage out.** The adapter assumes compilable input;
checking language syntax is not its job. Structure comes from tree-sitter (see
phase 2), which parses even the preprocessor cleanly — both branches of an
`#if/#else` land in the tree with correct nesting, so the old "undefined-depth
zone" for brace imbalance is gone. The residual risk is `ERROR` nodes on
macro-heavy code, which is verified against golden files.

## The core ↔ lang boundary

Complexity is split along two physical axes that meet at one narrow contract:

- `src/core/` — **Hatch semantics**, with zero knowledge of brackets, indents, or
  tree-sitter.
- `src/lang/` — **everything language-dependent**: nesting (`buildMap`, via
  tree-sitter) and text canonicalization (`normalize`).
- `src/lang/source-map.ts` — the **only** bridge. The matcher and the generator
  import this and nothing else from `lang/`.

The test for a correct boundary: *if adding a language forces a change in
`core/`, the boundary is wrong.* A new language is one new folder under `lang/`.

```ts
interface SourceMap {                         // ALL positions are CANONICAL
  matchesAt(norm, pos): boolean;              // match here? (respects token boundaries)
  occurrences(norm, from, to): number[];      // anchor occurrences in a window
  pair(openPos): number;                       // matching closer — the heart
  depthAt(pos): number;                        // nesting depth (diagnostics)
  enclosing(pos): number[];                    // enclosing structures (for synth)
  readonly eof: number;                        // canonical length
  toOriginal(pos, side): number;               // canonical mark pos → ORIGINAL offset
}
interface LanguageAdapter {
  init(): Promise<void>;                       // load tree-sitter grammar (WASM), once
  buildMap(source): SourceMap;                 // synchronous after init
  normalize(raw): string;                      // how to canonicalize literal text
  extensions: readonly string[];
}
```

|              | C++ implements as                    | Python implements as                 |
|--------------|--------------------------------------|--------------------------------------|
| `pair(open)` | `{ }` pair from the tree-sitter tree | block by indentation (tree-sitter-python) |
| `occurrences`| anchor search in `[from,to)`         | same, window by indentation          |
| `depthAt`    | depth in the tree                    | indentation level                    |
| `enclosing`  | enclosing braced nodes               | chain of enclosing indents           |

The map is **tested in isolation** from the matcher — `pair(N) == M` directly on
tricky inputs (brackets inside strings, raw literals, preprocessor zones). That
isolates the buggiest part of the system into a unit-testable unit.

## Coordinates: canonical throughout, original only for marks

The matcher works **entirely in canonical space** (the source after `normalize`):
`pos += norm.length` is trivial, windows and `pair` are canonical. Positions are
translated to **original** offsets only for marks, only at the end, via
`toOriginal`. This is sound because `normalize` only touches whitespace, so the
subsequence of non-whitespace characters is identical in the canonical and
original text (the k-th occurrence of any non-whitespace char in canon = the k-th
in original). So there are **no standing canon↔original index arrays** — the
translation is pointwise, by aligning non-whitespace characters.

`matchesAt` stays `boolean` (not `number|null`): the cursor is canonical and the
match length is `norm.length`, so advancing is trivial.

## The AST: a sequence of steps

A pattern is a sequence of **steps** `(gap, anchor)`. The gap says *how* to
advance the cursor; the anchor says *what* to stop on — a literal, or end-of-file.
Literals consume text; gaps carry the zero-width marks (`>>>`, `<<<`).

```ts
type GapMode =
  | { op: 'tight' } | { op: 'skipAny' }
  | { op: 'skipToFirst' } | { op: 'skipToLast' } | { op: 'skipToNth'; n: number };
type Mark = 'insert' | 'replaceEnd';
interface PlacedMark { mark: Mark; side: 'left' | 'right'; mdLine: number; seqNum: number; }
interface Literal { raw: string; mdLine: number; }     // RAW text; canon is the adapter's job
interface Gap { mode: GapMode; marks: PlacedMark[]; }
type Anchor = { target: 'literal'; literal: Literal } | { target: 'eof' };
interface Step { gap: Gap; anchor: Anchor; }
interface MatchPattern { steps: Step[]; }
```

The matcher walks it as a cursor stepping forward (canonical coordinates):

```
pos = 0                              // cursor in canon — this is ALL the left-state
for each step (gap, anchor):
    record gap.marks[side='left']  at pos     // left boundary = current cursor
    pos = resolveGap(gap.mode, pos, anchor)   // tight: stay; skip*: jump to anchor
    record gap.marks[side='right'] at pos     // right boundary = after the jump
    if anchor is literal: matchesAt | FAIL; pos += norm.length   (+ open-literal stack)
    else (eof): tight = pattern ended here; skipAny = jump to eof done
```

**Marks anchor to "symbol + side."** A mark sits between characters, with a side
that binds it to one non-whitespace character:

- `side='left'` (recorded before the jump): anchor = the previous literal's last
  non-whitespace char; insert goes right after it. No previous (first step) →
  position 0 = **BOF**.
- `side='right'` (recorded after the jump): anchor = the next anchor's first
  non-whitespace char; insert goes right before it. No next (reached EOF) →
  `source.length` = **EOF**.

So `A >>> ... B` inserts right after A (left); `A ... >>> B` inserts before B
(right). **BOF/EOF are not a separate flag** — they're the degenerate boundaries
of this rule (BOF = a left mark with no preceding char; EOF = a right mark with no
following char; empty file → 0). `>>> ...` is just a left mark at position 0, not
a special case. Replace ranges (`>>> … <<<`) follow the same rule: `>>>` gives the
start, `<<<` the end. The canon→original translation is `map.toOriginal(canonPos,
side)`, computed only for marks.

End-of-file is an explicit, typed anchor, so "insert at end" and "no literals at
all" are union variants, not special-cased empty trailing gaps. Discriminants are
domain-named (`op`, `target`), not a generic `kind`.

## Apply runs hunks sequentially

`apply` applies hunks **one at a time, each against the current (already-mutated)
state**:

```
await adapter.init()                 // load the tree-sitter grammar once
current = read(inFile)
for each hunk:
    map = adapter.buildMap(current)  // map of the CURRENT text (O(n) per hunk)
    edit = patcher(matcher(hunk.match, map), current)
    current = apply(edit, current)
write_atomic(outFile, current)       // one temp+rename at the end
```

This lets a hunk anchor to content a previous hunk introduced (matching against
the pristine original couldn't find it), and it's what makes `generate` tractable
when changes cluster — the synthesizer can emit *dependent* hunks anchored to the
progressively-transformed surroundings. The earlier "match everything against the
original, apply edits end-to-start" model is dropped; it broke exactly this. The
cost is one `buildMap` (tree-sitter parse) per hunk — negligible for typical
patches; incremental map updates are a later optimization. Atomicity is preserved:
one write of the final string.

## Normalization lives in the adapter, not the core

"What counts as insignificant whitespace" is a fact about the *language*, exactly
like "what is a bracket." So it's `LanguageAdapter.normalize(raw): string`, not a
core function. The core stores the literal **raw**. The parser is language-neutral
and runs *before* the language is chosen, so it has nothing to normalize with; the
matcher computes the canon lazily once the adapter is known, caching it per run.

- **C++** (`lang/cpp/normalize.ts`, also fine for C-likes): whitespace is
  significant *only between two word characters* `[A-Za-z0-9_]`; everywhere else —
  around punctuation, newlines, and the leading indent — it's dropped. So
  `int x` ≠ `intx`, but `features {` ≡ `features{`. Known limit: whitespace inside
  string literals is data (`" "` → `""`); both sides canonicalize the same way so
  self-matching holds; the proper fix uses tree-sitter's string nodes (phase 5).
- **Python** (`lang/python/normalize.ts`, phase 5): the leading indent is
  *preserved* as a level marker. That's why the parser keeps the leading
  whitespace of a line-start fragment in `raw`.

Structure (`buildMap`) comes from tree-sitter for both languages; only `normalize`
differs per language.

## The two pipelines share one source of truth

```
apply:    .md ─parse→ MatchPattern ┐
          source ─buildMap→ SourceMap ┘─matcher→ edit ─patcher→ (per hunk) → atomic write

generate: (old,new) ─diff→ hunks ─synth→ MatchPattern ─printer→ .md
```

`generate`'s synthesizer climbs `enclosing()` of the *same* `SourceMap` that
`apply` uses. One source of truth about file structure feeds both pipelines, so
`apply` and `generate` can't drift apart.

## Diagnostics and invariants (green on every commit)

- **Parser round-trip:** `parse(print(ast))` ≡ `ast` structurally.
- **System round-trip:** `apply(generate(old,new), old) == new` on all golden
  fixtures (real-world examples), including clustered changes.
- **Map in isolation:** `pair` correct on tricky C++/Python inputs.
- **Ambiguity:** a second valid match makes the matcher warn ("add context or use
  `^..`"). Silently picking the first of two valid spots is the worst possible bug.
- **Failure diagnostics:** on FAIL, the matcher reports the *deepest* point
  reached (position + which step failed; translated to original for the message).
- **Idempotency:** re-applying an already-applied patch doesn't corrupt the file.

Errors carry their CI exit code (`src/core/errors.ts`): `ParseError`→2,
`MatchError`→3, `AmbiguityError`→4, `AlreadyAppliedError`→5; the base `HatchError`
is abstract.

## tree-sitter is the default structure provider

`buildMap` parses the source with tree-sitter and reads brace pairs straight from
the syntax tree (`compound_statement` and similar nodes — detected by their first/
last child being `{`/`}`), giving `pair`/`depthAt`/`enclosing`. This replaces a
hand-written character scanner and bracket matcher — precisely the parts that are
buggiest to hand-roll (raw strings, the C++14 digit separator `'`, string
prefixes, preprocessor imbalance), all of which tree-sitter handles. We keep our
own `normalize`/canon (tree-sitter doesn't collapse whitespace for fuzzy matching)
and the mapping of node offsets into canonical coordinates.

The WASM build is used (cross-platform, no native compilation, stable across Node
versions). Cost: a dependency (web-tree-sitter + the `.wasm` grammars, bundled via
package.json `files`) and an **async init** — `Parser.init()`/`Language.load()`
return promises, so the adapter exposes `init(): Promise<void>`, awaited once at
CLI startup; `buildMap` is synchronous thereafter. libclang/clangd were rejected:
they need the project's full compile environment (flags, includes), a heavy native
dependency, and an async server — reintroducing the build-coupling this port
exists to remove.
