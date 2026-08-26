// core/errors.ts — the error taxonomy, and the exit code of each. The rule for what
// lives here: an error carries FACTS (offsets, step indices, the anchor text it stood
// on), never a rendered report. Turning facts into something a human acts on needs the
// source file, the .md and a terminal width — none of which the core has any business
// knowing. That rendering lives in infra/log.ts.
export abstract class HatchError extends Error {
  abstract readonly exitCode: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ParseError extends HatchError {
  readonly exitCode = 2;
  readonly mdLine: number;
  readonly hint?: string;

  constructor(message: string, mdLine: number, hint?: string) {
    super(
      `line ${mdLine}: ${message}` +
        (hint !== undefined ? `\n  hint: ${hint}` : ''),
    );
    this.mdLine = mdLine;
    if (hint !== undefined) this.hint = hint;
  }
}

/**
 * Where the walk got stuck. `deepestPos` is CANONICAL — it is a position in the
 * normalized text, which is what the matcher lives in. Everything a report needs is
 * therefore carried SEPARATELY, already translated into ORIGINAL offsets: nobody
 * outside the matcher can do that translation, since the map is gone by then.
 *
 * `anchorText`  — the anchor the walk stood on, as written in the .md. A step index
 *                 alone tells a human nothing; the text they wrote does.
 * `matchedText` — the last anchor that DID match, so the report can say how far it got.
 * `hint`        — an explanation attached where the failure mode is known and
 *                 counter-intuitive. The tail `...` is the case that costs people an
 *                 hour: a pattern ending on `>>>` with no `...` means "the file ends
 *                 here", and nothing in the old message said so.
 */
export class MatchError extends HatchError {
  readonly exitCode = 3;
  readonly deepestPos: number;
  readonly failedStepIndex: number;
  readonly totalSteps: number | undefined;
  /** Same place as deepestPos, but as an offset into the ORIGINAL file. */
  readonly origPos: number | undefined;
  readonly anchorText: string | undefined;
  readonly matchedText: string | undefined;
  readonly matchedPos: number | undefined;
  readonly hint: string | undefined;

  constructor(
    message: string,
    deepestPos: number,
    failedStepIndex: number,
    detail: {
      readonly totalSteps?: number;
      readonly origPos?: number;
      readonly anchorText?: string;
      readonly matchedText?: string;
      readonly matchedPos?: number;
      readonly hint?: string;
    } = {},
  ) {
    super(message);
    this.deepestPos = deepestPos;
    this.failedStepIndex = failedStepIndex;
    this.totalSteps = detail.totalSteps;
    this.origPos = detail.origPos;
    this.anchorText = detail.anchorText;
    this.matchedText = detail.matchedText;
    this.matchedPos = detail.matchedPos;
    this.hint = detail.hint;
  }
}

export class ConfigError extends HatchError {
  readonly exitCode = 5;
  readonly file: string | undefined;

  constructor(message: string, file?: string) {
    super(file !== undefined ? `${file}: ${message}` : message);
    this.file = file;
  }
}


export class GrammarError extends HatchError {
  readonly exitCode = 6;
  readonly grammar: string | undefined;

  constructor(message: string, grammar?: string) {
    super(grammar !== undefined ? `${grammar}: ${message}` : message);
    this.grammar = grammar;
  }
}

/**
 * The pattern fits in more than one place. `positions` are ORIGINAL offsets of the
 * competing EDITS, one per differing outcome — and there are exactly two of them,
 * because the matcher stops as soon as a second one turns up. `spanEnds`, when present,
 * are the ends of those edits, so a report can quote the whole competing span and not
 * just point at where it starts.
 */
export class AmbiguityError extends HatchError {
  readonly exitCode = 4;
  readonly positions: number[];
  readonly spanEnds: (number | undefined)[];

  constructor(message: string, positions: number[], spanEnds: (number | undefined)[] = []) {
    super(message);
    this.positions = positions;
    this.spanEnds = spanEnds;
  }
}
