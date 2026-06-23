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
      `строка ${mdLine}: ${message}` +
        (hint !== undefined ? `\n  подсказка: ${hint}` : ''),
    );
    this.mdLine = mdLine;
    if (hint !== undefined) this.hint = hint;
  }
}

export class MatchError extends HatchError {
  readonly exitCode = 3;
  readonly deepestPos: number;
  readonly failedStepIndex: number;

  constructor(message: string, deepestPos: number, failedStepIndex: number) {
    super(message);
    this.deepestPos = deepestPos;
    this.failedStepIndex = failedStepIndex;
  }
}

export class AmbiguityError extends HatchError {
  readonly exitCode = 4;
  readonly positions: number[];

  constructor(message: string, positions: number[]) {
    super(message);
    this.positions = positions;
  }
}

export class AlreadyAppliedError extends HatchError {
  readonly exitCode = 5;

  constructor(message: string) {
    super(message);
  }
}
