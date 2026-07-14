export type GapMode =
  | { op: 'tight' } // нет пропуска
  | { op: 'skipAny' }; // ...

export interface PlacedMark {
  side: 'left' | 'right'; // left = cursor position BEFORE the jump; right = AFTER
  mdLine: number;
}

export interface Literal {
  raw: string;
  mdSpan: [number, number];
}

export interface Gap {
  mode: GapMode;
  insert?: PlacedMark; // >>>
  replaceEnd?: PlacedMark; // <<<
}

export type Anchor =
  | { target: 'literal'; literal: Literal }
  | { target: 'eof' };

export interface Step {
  gap: Gap;
  anchor: Anchor;
}

export interface MatchPattern {
  steps: Step[];
}

export interface Hunk {
  match: MatchPattern;
  patch: string;
  mdSpan: [number, number];
}

export interface HatchFile {
  hunks: Hunk[];
  language?: string;
}