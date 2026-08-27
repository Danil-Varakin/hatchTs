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

export class MatchError extends HatchError {
  readonly exitCode = 3;
  readonly deepestPos: number;
  readonly failedStepIndex: number;
  readonly totalSteps: number | undefined;
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
