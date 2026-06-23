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
        'два оператора пропуска в одном зазоре',
        mdLine,
        'метки прозрачны: «... >>> ...» — тоже два пропуска подряд; оставьте один',
      );
    }
    this.gap.mode = mode;
    this.skipSeen = true;
  }

  addInsert(mdLine: number): void {
    if (this.insertMark !== null) {
      throw new ParseError(
        `повторная точка вставки >>> (первая — на строке ${this.insertMark.mdLine})`,
        mdLine,
        'нужно два места вставки — сделайте два ханка match/patch',
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
        'маркер <<< без предшествующего >>>: конец диапазона раньше начала',
        mdLine,
        '<<< всегда после >>> — это конец диапазона замены, начатого вставкой',
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
        'в блоке match нет точки вставки >>>',
        this.blockLine,
        'каждому телу патча нужна ровно одна позиция вставки',
      );
    }
    return { steps: this.steps };
  }
}


const OP_RE =
  /(?<=^|\s)(\.\.\.|>>>|<<<|\^\.\.|\.\.\^|\^(?<n>\d+)\.\.)(?=\s|$)/g;

const ESCAPE_RE = /\\(?=(\.\.\.|>>>|<<<|\^\.\.|\.\.\^|\^\d+\.\.))/g;

function scanLineInto(line: string, mdLine: number, b: PatternBuilder): void {
  let last = 0;
  let atLineStart = true; 
  for (const m of line.matchAll(OP_RE)) {
    const idx = m.index ?? 0;
    const op = m[0] ?? '';
    feedFragment(line.slice(last, idx), atLineStart, mdLine, b);
    feedOperator(op, m.groups?.['n'], mdLine, b);
    last = idx + op.length;
    atLineStart = false;
  }
  feedFragment(line.slice(last), atLineStart, mdLine, b);
}

function feedFragment(
  frag: string,
  atLineStart: boolean,
  mdLine: number,
  b: PatternBuilder,
): void {
  const unescaped = frag.replace(ESCAPE_RE, '');
  const raw = atLineStart ? unescaped.trimEnd() : unescaped.trim();
  if (raw === '') return;
  b.addLiteral(raw, mdLine);
}

function feedOperator(
  op: string,
  n: string | undefined,
  mdLine: number,
  b: PatternBuilder,
): void {
  switch (op) {
    case '...':
      b.addGapMode({ op: 'skipAny' }, mdLine);
      break;
    case '^..':
      b.addGapMode({ op: 'skipToFirst' }, mdLine);
      break;
    case '..^':
      b.addGapMode({ op: 'skipToLast' }, mdLine);
      break;
    case '>>>':
      b.addInsert(mdLine);
      break;
    case '<<<':
      b.addReplaceEnd(mdLine);
      break;
    default: {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1) {
        throw new ParseError(
          `некорректный номер вхождения в операторе ^${n}..`,
          mdLine,
          'нумерация вхождений с 1: ^1.. эквивалентно ^..',
        );
      }
      b.addGapMode({ op: 'skipToNth', n: num }, mdLine);
    }
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
    const no = i + 1;

    switch (state) {
      case 'scan':
        if (MATCH_HEADING.test(line)) {
          state = 'wantMatchFence';
          hunkStart = no;
        }
        break;

      case 'wantMatchFence': {
        const m = line.match(FENCE_OPEN);
        if (m !== null) {
          const lang = m[1];
          if (language === undefined && lang) language = lang;
          builder = new PatternBuilder(hunkStart);
          state = 'inMatch';
        } else if (line.trim() !== '') {
          throw new ParseError('после заголовка match ожидается блок ```', no);
        }
        break;
      }

      case 'inMatch':
        if (FENCE_CLOSE.test(line)) state = 'wantPatchHeading';
        else scanLineInto(line, no, builder!);
        break;

      case 'wantPatchHeading':
        if (PATCH_HEADING.test(line)) state = 'wantPatchFence';
        else if (line.trim() !== '') {
          throw new ParseError(
            'после блока match ожидается заголовок patch',
            no,
            'блок match без patch не имеет смысла',
          );
        }
        break;

      case 'wantPatchFence':
        if (FENCE_OPEN.test(line)) {
          patchLines = [];
          state = 'inPatch';
        } else if (line.trim() !== '') {
          throw new ParseError('после заголовка patch ожидается блок ```', no);
        }
        break;

      case 'inPatch':
        if (FENCE_CLOSE.test(line)) {
          const match = builder!.finish();
          hunks.push({
            match,
            patch: patchLines.join('\n'),
            mdSpan: [hunkStart, no],
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
      `файл оборван посреди блока (состояние: ${state})`,
      lines.length,
      'не закрыт ``` или нет пары patch к последнему match',
    );
  }
  if (hunks.length === 0) {
    throw new ParseError('в файле не найдено ни одной пары match/patch', 1);
  }

  const file: HatchFile = { hunks };
  if (language !== undefined) file.language = language;
  return file;
}