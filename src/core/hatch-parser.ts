import type {
  GapMode,
  PlacedMark,
  Gap,
  Step,
  MatchPattern,
  Hunk,
  HatchFile,
} from './ast.ts';
import { ParseError } from './errors.ts';


function freshGap(): Gap {
  return { mode: { op: 'tight' } };
}


class PatternBuilder {
  private steps: Step[] = [];
  private gap: Gap = freshGap();
  private skipSeen = false;
  private insertMark: PlacedMark | null = null;
  private replaceEndMark: PlacedMark | null = null;
  private readonly blockLine: number;

  constructor(blockLine: number) {
    this.blockLine = blockLine;
  }

  addLiteral(raw: string, mdLine: number): void {
    const prev = this.steps[this.steps.length - 1];
    const gapIsFresh =
      this.gap.mode.op === 'tight' &&
      this.gap.insert === undefined &&
      this.gap.replaceEnd === undefined;

    if (gapIsFresh && prev !== undefined && prev.anchor.target === 'literal') {
      const lit = prev.anchor.literal;
      lit.raw += '\n' + raw;
      lit.mdSpan[1] = mdLine; 
      return; 
    }

    this.steps.push({
      gap: this.gap,
      anchor: { target: 'literal', literal: { raw, mdSpan: [mdLine, mdLine] } },
    });
    this.gap = freshGap();
    this.skipSeen = false;
  }

  addGapMode(mode: GapMode, mdLine: number): void {
    if (this.skipSeen) {
      throw new ParseError(
        'two skip operators in one gap',
        mdLine,
        'the labels are transparent: "... >>> ..." — also two passes in a row; leave one',
      );
    }
    this.gap.mode = mode;
    this.skipSeen = true;
  }

  addInsert(mdLine: number): void {
    if (this.insertMark !== null) {
      throw new ParseError(
        `repeat insertion point >>> (the first one is on the line ${this.insertMark.mdLine})`,
        mdLine,
        'you need two insertion points — make two match/patch hanks',
      );
    }
    const placed: PlacedMark = {
      side: this.skipSeen ? 'right' : 'left',
      mdLine,
    };
    this.gap.insert = placed;
    this.insertMark = placed;
  }

  addReplaceEnd(mdLine: number): void {
    if (this.insertMark === null) {
      throw new ParseError(
        'marker <<< without preceding >>>: end of range before start',
        mdLine,
        '<<< always after >>> is the end of the replacement range started by the insertion',
      );
    }
    if (this.replaceEndMark !== null) {
      throw new ParseError(
        `повторный маркер <<< (первый — на строке ${this.replaceEndMark.mdLine})`,
        mdLine,
      );
    }
    const placed: PlacedMark = {
      side: this.skipSeen ? 'right' : 'left',
      mdLine,
    };
    this.gap.replaceEnd = placed;
    this.replaceEndMark = placed;
  }

  finish(): MatchPattern {
    if (
      this.gap.insert !== undefined ||
      this.gap.replaceEnd !== undefined ||
      this.gap.mode.op !== 'tight'
    ) {
      this.steps.push({ gap: this.gap, anchor: { target: 'eof' } });
      this.gap = freshGap();
    }
    if (this.insertMark === null) {
      throw new ParseError(
        'there is no insertion point in the match block >>>',
        this.blockLine,
        'each patch body needs exactly one insertion position.',
      );
    }
    return { steps: this.steps };
  }
}


const OP_RE = /(?<=^|\s)(\.\.\.|>>>|<<<)(?=\s|$)/g;

// Экран снимается ТОЛЬКО там, где оператор без '\' был бы распознан как
// обособленное слово; снимается ОДНА '\' с начала цепочки. '\...' в середине
// слова (например, внутри строкового литерала C++) — обычный текст, не трогаем.
// Принтер симметрично ДОБАВЛЯЕТ одну '\' — round-trip не теряет и не плодит слэши.
const ESCAPE_RE = /(?<=^|\s)\\(?=\\*(?:\.\.\.|>>>|<<<)(?:\s|$))/g;

function scanLineInto(line: string, mdLine: number, builder: PatternBuilder): void {
  let last = 0;
  let atLineStart = true;
  for (const m of line.matchAll(OP_RE)) {
    const idx = m.index ?? 0;
    const op = m[0] ?? '';
    feedFragment(line.slice(last, idx), atLineStart, mdLine, builder);
    feedOperator(op, mdLine, builder);
    last = idx + op.length;
    atLineStart = false;
  }
  feedFragment(line.slice(last), atLineStart, mdLine, builder);
}

function feedFragment(
  frag: string,
  atLineStart: boolean,
  mdLine: number,
  builder: PatternBuilder,
): void {
  const unescaped = frag.replace(ESCAPE_RE, '');
  const raw = atLineStart ? unescaped.trimEnd() : unescaped.trim();
  if (raw === '') return;
  builder.addLiteral(raw, mdLine);
}

function feedOperator(op: string, mdLine: number, builder: PatternBuilder): void {
  switch (op) {
    case '...':
      builder.addGapMode({ op: 'skipAny' }, mdLine);
      break;
    case '>>>':
      builder.addInsert(mdLine);
      break;
    case '<<<':
      builder.addReplaceEnd(mdLine);
      break;
  }
}


const MATCH_HEADING = /^#{1,6}\s*match:?\s*$/i;
const PATCH_HEADING = /^#{1,6}\s*patch:?\s*$/i;
const FENCE_OPEN = /^```(\S*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;

type ScanState =
  | 'scan'
  | 'wantMatchFence'
  | 'inMatch'
  | 'wantPatchHeading'
  | 'wantPatchFence'
  | 'inPatch';

export function parseHatchFile(md: string): HatchFile {
  const lines = md.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let language: string | undefined;

  let state: ScanState = 'scan';
  let builder: PatternBuilder | null = null;
  let patchLines: string[] = [];
  let hunkStart = 0;

  for (const [i, line] of lines.entries()) {
    const lineNo = i + 1;

    switch (state) {
      case 'scan':
        if (MATCH_HEADING.test(line)) {
          state = 'wantMatchFence';
          hunkStart = lineNo;
        }
        break;

      case 'wantMatchFence': {
        const m = line.match(FENCE_OPEN);
        if (m !== null) {
          const lang = m[1];
          if (lang) {
            if (language === undefined) language = lang;
            else if (language !== lang) {
              throw new ParseError(
                `match block declares language '${lang}', but the file already uses '${language}'`,
                lineNo,
                'one .md file — one language; split the hunks into separate files',
              );
            }
          }
          builder = new PatternBuilder(hunkStart);
          state = 'inMatch';
        } else if (line.trim() !== '') {
          throw new ParseError('a block is expected after the match header. ```', lineNo);
        }
        break;
      }

      case 'inMatch':
        if (FENCE_CLOSE.test(line)) state = 'wantPatchHeading';
        else scanLineInto(line, lineNo, builder!);
        break;

      case 'wantPatchHeading':
        if (PATCH_HEADING.test(line)) state = 'wantPatchFence';
        else if (line.trim() !== '') {
          throw new ParseError(
            'the patch header is expected after the match block.',
            lineNo,
            'A match block without a patch doesn\'t make sense.',
          );
        }
        break;

      case 'wantPatchFence':
        if (FENCE_OPEN.test(line)) {
          patchLines = [];
          state = 'inPatch';
        } else if (line.trim() !== '') {
          throw new ParseError('a block is expected after the patch header ```', lineNo);
        }
        break;

      case 'inPatch':
        if (FENCE_CLOSE.test(line)) {
          const match = builder!.finish();
          hunks.push({
            match,
            patch: patchLines.join('\n'),
            mdSpan: [hunkStart, lineNo],
          });
          builder = null;
          state = 'scan';
        } else {
          patchLines.push(line);
        }
        break;
    }
  }

  if (state !== 'scan') {
    throw new ParseError(
      `the file is cut off in the middle of the block (condition: ${state})`,
      lines.length,
      'not closed `` or there is no patch pair to the last match',
    );
  }
  if (hunks.length === 0) {
    throw new ParseError('no match/patch pairs were found in the file.', 1);
  }

  const file: HatchFile = { hunks };
  if (language !== undefined) file.language = language;
  return file;
}