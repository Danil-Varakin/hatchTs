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
        `repeat end-of-range marker <<< (the first one is on the line ${this.replaceEndMark.mdLine})`,
        mdLine,
        'a replacement range has exactly one end; remove the extra <<<',
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

const MATCH_HEADING = /^#{1,6}[ \t]*match:?(?:[ \t]+(\S+))?[ \t]*$/i;
const PATCH_HEADING = /^#{1,6}[ \t]*patch:?[ \t]*$/i;
const END_HEADING = /^#{1,6}[ \t]*end[ \t]*$/i;

const GUTTER = '    ';

interface Block {
  body: string[];
  firstLine: number;
  endLine: number;
  next: number;
}

function readBlock(lines: string[], start: number, kind: 'match' | 'patch', headLine: number): Block {
  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (END_HEADING.test(line)) {
      return { body, firstLine: start + 1, endLine: i + 1, next: i + 1 };
    }
    if (line.startsWith(GUTTER)) {
      body.push(line.slice(GUTTER.length));
    } else if (line.trim() === '') {
      body.push('');
    } else {
      throw bodyLineError(line, i + 1, kind);
    }
  }
  throw new ParseError(
    `the ${kind} block is not closed`,
    headLine,
    "every block ends with a '# end' line in column 0",
  );
}

function bodyLineError(line: string, mdLine: number, kind: 'match' | 'patch'): ParseError {
  if (line.startsWith('```')) {
    return new ParseError(
      'the fenced format is no longer supported',
      mdLine,
      "drop the ``` fences, indent every payload line with four spaces and close each " +
        "block with '# end'; the language goes into the heading: '# match cpp'",
    );
  }
  if (MATCH_HEADING.test(line) || PATCH_HEADING.test(line)) {
    return new ParseError(
      `the ${kind} block is not closed: '${line.trim()}' found where '# end' was expected`,
      mdLine,
    );
  }
  const shown = line.trim();
  return new ParseError(
    `a line of the ${kind} block must start with four spaces`,
    mdLine,
    `indent '${shown.length > 40 ? shown.slice(0, 40) + '…' : shown}', or close the block with '# end'`,
  );
}

export function parseHatchFile(md: string): HatchFile {
  const lines = md.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let language: string | undefined;

  let i = 0;
  while (i < lines.length && !MATCH_HEADING.test(lines[i]!)) i++;

  while (i < lines.length) {
    const head = lines[i]!.match(MATCH_HEADING);
    if (head === null) {
      if (lines[i]!.trim() !== '') {
        throw new ParseError(
          'text between hunks is not supported',
          i + 1,
          "after '# end' only blank lines are allowed; put the commentary before the first '# match'",
        );
      }
      i++;
      continue;
    }

    const hunkStart = i + 1;
    const lang = head[1];
    if (lang !== undefined) {
      if (language === undefined) language = lang;
      else if (language !== lang) {
        throw new ParseError(
          `match block declares language '${lang}', but the file already uses '${language}'`,
          hunkStart,
          'one .md file — one language; split the hunks into separate files',
        );
      }
    }

    const matchBlock = readBlock(lines, i + 1, 'match', hunkStart);

    let j = matchBlock.next;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    if (j >= lines.length || !PATCH_HEADING.test(lines[j]!)) {
      throw new ParseError(
        'the patch header is expected after the match block',
        j >= lines.length ? lines.length : j + 1,
        "a match block without a patch doesn't make sense",
      );
    }
    const patchBlock = readBlock(lines, j + 1, 'patch', j + 1);

    const builder = new PatternBuilder(hunkStart);
    for (const [k, raw] of matchBlock.body.entries()) {
      scanLineInto(raw, matchBlock.firstLine + k, builder);
    }

    hunks.push({
      match: builder.finish(),
      patch: patchBlock.body.join('\n'),
      mdSpan: [hunkStart, patchBlock.endLine],
    });
    i = patchBlock.next;
  }

  if (hunks.length === 0) {
    throw new ParseError('no match/patch pairs were found in the file.', 1);
  }

  const file: HatchFile = { hunks };
  if (language !== undefined) file.language = language;
  return file;
}
