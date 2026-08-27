
export interface GrammarSource {
  readonly file: string;
  readonly package?: string;
  readonly version?: string;
  readonly sha256?: string;
  readonly url?: string;
  readonly path?: string;
}

export interface InitOptions {
  readonly allowDownload?: boolean | undefined;
  readonly log?: ((message: string) => void) | undefined;
}

export interface BlockSpan {
  open: number;
  close: number;
  headerStart?: number;
  closeEnd?: number;
}

export interface SourceMap {
  matchesAt(norm: string, pos: number): boolean;
  occurrences(norm: string, from: number, to: number): number[];
  enclosingEnd(pos: number): number;
  depthAt(pos: number): number;
  enclosing(pos: number): BlockSpan[];
  blocksWithin(from: number, to: number): BlockSpan[];
  readonly eof: number;
  toOriginalPos(pos: number, side: 'left' | 'right'): number;
  toCanonPos(origPos: number): number;
}

export interface LanguageAdapter {
  init(options?: InitOptions): Promise<void>;

  buildMap(source: string): SourceMap;

  normalize(raw: string): string;

  readonly name: string;

  extensions: readonly string[];

  readonly grammar: GrammarSource;
}
