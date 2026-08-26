// lang/zones.ts — SHARED MECHANISM: how to find string literals in text, given rules
// that each language declares in its own folder. The mechanism is common (same as walk,
// buildCanon, isWordChar); WHAT counts as a string is a fact about a language and stays
// in lang/<name>/, per the one-folder-per-language rule.
//
// WHY THIS EXISTS: whitespace inside a string literal is DATA, not formatting. Without
// this, canon collapses it, and `Log("value  with   spaces")` in the file matches an
// instruction that says `Log("value with spaces")` — silently, with no error. Losing a
// patch onto a line the author did not mean is the worst class of bug we have.
//
// WHY IT IS TEXTUAL AND NOT tree-sitter: both canons must agree. The source canon could
// ask the tree, but a LITERAL out of a .md is a fragment with no tree of its own — and
// if the two sides disagree about where a string starts, the matcher lies in both
// directions. One pure text function, used by both sides, agrees by construction.
//
// COMMENTS ARE NOT ZONES, deliberately. Whitespace in a comment is presentation, not
// data: re-indenting a block rewrites the interior of a multi-line `/* … */`, and that
// case is on the "proven solid" list (KNOWN-ISSUES §5). Strings are the ones that carry
// meaning, and the ones that produced a real silent false match.

/**
 * One kind of string literal. `open` is matched at a position (a RegExp must be
 * anchorable — it is re-created sticky); `close` is either fixed text or a function of
 * the opening match, for delimiters that carry their own terminator (C++ `R"tag(…)tag"`).
 *
 * `escape` — the character that makes the next character literal (absent in raw forms).
 * `multiline` — whether the literal may span '\n'. A single-line literal that is never
 * closed ends at the end of its line: an unterminated quote must not swallow the file,
 * least of all in a fragment that starts mid-string.
 */
export interface StringRule {
  readonly open: string | RegExp;
  readonly close: string | ((open: RegExpExecArray) => string);
  readonly escape?: string;
  readonly multiline?: boolean;
}

/**
 * A string literal INCLUDING its delimiters, as [start, end).
 *
 * `opaque` — whether canon keeps this literal's interior verbatim. TRUE exactly when the
 * literal holds no newline, and that condition is the whole safety argument:
 *
 * A literal out of a .md is a FRAGMENT, cut on line boundaries (synth cuts there, and a
 * handwritten anchor is lines of code). A single-line string can therefore never be cut
 * in half — a fragment either contains it whole, delimiters and all, or does not touch
 * it, so both sides of the comparison reach the same verdict. A MULTI-LINE literal (C++
 * `R"(…)"`, a docstring, a template literal, a Go backtick) CAN be cut in half, and the
 * fragment then has no way to know it sits inside one: it would collapse the whitespace
 * that the source side kept, and the two canons would disagree — which is the same class
 * of silent wrongness this file exists to remove, only pointing the other way.
 *
 * So multi-line literals stay transparent (their whitespace collapses as before). They
 * are still SCANNED, though — that is why they are here at all: consuming `R"(a "b" c)"`
 * as one zone stops the inner `"b"` from opening a zone of its own.
 */
export interface Zone {
  readonly start: number;
  readonly end: number;
  readonly opaque: boolean;
}

/**
 * Every string literal in `text`, in order, non-overlapping. Rules are tried in the
 * order given, so a language lists its longer openers first (`"""` before `"`).
 */
export function stringZones(text: string, rules: readonly StringRule[]): Zone[] {
  const compiled = rules.map(compile);
  const out: Zone[] = [];
  let i = 0;
  while (i < text.length) {
    const zone = zoneAt(text, i, compiled);
    if (zone === null) {
      i++;
      continue;
    }
    out.push(zone);
    i = zone.end;
  }
  return out;
}

/**
 * Replace whitespace runs OUTSIDE opaque string literals, keeping runs inside them
 * verbatim. `collapse` receives the run and its offset in `text` and returns what it
 * becomes — that decision is the language's whitespace rule and stays with the language.
 *
 * Checking only where a run STARTS is exact, not an approximation: a delimiter is never
 * whitespace, so no run can straddle a zone border.
 */
export function replaceWhitespaceOutsideStrings(
  text: string,
  rules: readonly StringRule[],
  collapse: (ws: string, offset: number) => string,
): string {
  const zones = stringZones(text, rules).filter((z) => z.opaque);
  if (zones.length === 0) return text.replace(/\s+/g, collapse);
  return text.replace(/\s+/g, (ws: string, offset: number) =>
    inZone(zones, offset) ? ws : collapse(ws, offset),
  );
}

/** Whether an offset falls inside one of the given zones. Binary search; zones sorted. */
export function inZone(zones: readonly Zone[], offset: number): boolean {
  let lo = 0;
  let hi = zones.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const z = zones[mid]!;
    if (offset < z.start) hi = mid - 1;
    else if (offset >= z.end) lo = mid + 1;
    else return true;
  }
  return false;
}

interface Compiled {
  readonly open: string | RegExp;
  readonly close: string | ((open: RegExpExecArray) => string);
  readonly escape: string | undefined;
  readonly multiline: boolean;
}

function compile(rule: StringRule): Compiled {
  const open =
    typeof rule.open === 'string' ? rule.open : new RegExp(rule.open.source, stickyFlags(rule.open));
  return {
    open,
    close: rule.close,
    escape: rule.escape,
    multiline: rule.multiline === true,
  };
}

function stickyFlags(re: RegExp): string {
  return re.flags.includes('y') ? re.flags : `${re.flags}y`;
}

function zoneAt(text: string, start: number, rules: readonly Compiled[]): Zone | null {
  for (const rule of rules) {
    const opened = matchOpen(text, start, rule.open);
    if (opened === null) continue;
    const closer = typeof rule.close === 'string' ? rule.close : rule.close(opened.match);
    const end = findClose(text, start + opened.length, closer, rule);
    // Opacity is decided by the TEXT, not by the rule: a `"""a b"""` that fits on one
    // line is as safe as a plain quote, and a rule that merely ALLOWS newlines does not
    // mean this occurrence used any. See the Zone doc for why the newline is the line.
    return { start, end, opaque: !text.slice(start, end).includes('\n') };
  }
  return null;
}

function matchOpen(
  text: string,
  at: number,
  open: string | RegExp,
): { length: number; match: RegExpExecArray } | null {
  if (typeof open === 'string') {
    if (!text.startsWith(open, at)) return null;
    return { length: open.length, match: [open] as unknown as RegExpExecArray };
  }
  open.lastIndex = at;
  const m = open.exec(text);
  if (m === null || m.index !== at || m[0].length === 0) return null;
  return { length: m[0].length, match: m };
}

/** End of the literal (past the closing delimiter), or the line/text end if unclosed. */
function findClose(text: string, from: number, closer: string, rule: Compiled): number {
  const esc = rule.escape;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (esc !== undefined && ch === esc) {
      i++;
      continue;
    }
    if (!rule.multiline && ch === '\n') return i;
    if (text.startsWith(closer, i)) return i + closer.length;
  }
  return text.length;
}
