import { ParseError } from './errors.ts';

// The header of a .hatch: `Name: value` lines, DEP-3 style, from the first non-blank
// line of the file to the first blank one.
//
//   Hatch: 1
//   Target: chrome/browser/feature_list.cc
//   Generated-From: 3f2a9c1e…
//   Generated-By: hatch 0.4.0
//   Grammar: tree-sitter-cpp@0.23.4
//
// `Hatch` is the format number and comes first (VERSIONING.md H1–H4); a file without a
// header is format 1. Names are read without regard to case, and a name hatch does not
// know is read past: a new field never needs a new number.
//
// The fields hatch knows have a fixed place: FIELDS, in this order, is the order they
// are written in and the order a reader holds them to. A new field goes to the end of
// the list — never between two that exist, never in place of one (H4) — so a header an
// older hatch wrote keeps its order in every later one.

export const FORMAT_MIN = 1;
export const FORMAT_VERSION = 1;

/** Every field hatch knows, in its place, with the name it has in `HeaderFields` — the
 *  ONE list the reader, the writer and the types are made of. Append only (H4). */
const FIELDS = [
  ['Hatch', null],
  ['Target', 'target'],
  ['Generated-From', 'generatedFrom'],
  ['Generated-By', 'generatedBy'],
  ['Grammar', 'grammar'],
] as const;

export type HeaderFieldName = (typeof FIELDS)[number][0];
type FieldKey = NonNullable<(typeof FIELDS)[number][1]>;

/** The names, in their order: line 1 of a header is `Hatch`, the rest follow in this
 *  order, each at most once. */
export const HEADER_FIELDS: readonly HeaderFieldName[] = FIELDS.map(([name]) => name);

/** The place of a known field (0 is `Hatch`), or -1 for one hatch does not know. */
function fieldPosition(name: string): number {
  const lower = name.toLowerCase();
  return HEADER_FIELDS.findIndex((f) => f.toLowerCase() === lower);
}

/** The fields beside the format number:
 *  - `target` — the file the patch is for, relative, with `/`;
 *  - `generatedFrom` — the id of the git object the patch was generated against;
 *  - `generatedBy` — `hatch <version>`;
 *  - `grammar` — `<package>@<version>`. */
export type HeaderFields = { [K in FieldKey]?: string | undefined };

export interface ParsedHeader {
  readonly format: number;
  /** every field, its name lower-cased; the last one wins */
  readonly fields: ReadonlyMap<string, string>;
  /** the line after the header (its blank line included), counted from 0; 0 without one */
  readonly endLine: number;
}

/** A header as written, before it is held to the format range and to a safe `Target`
 *  — for a reader that has to tell those apart (`pair`). */
export interface HeaderLines extends ParsedHeader {
  /** the lines of `Hatch` and of `Target`, counted from 1 */
  readonly formatLine: number;
  readonly targetLine: number | undefined;
}

const FIELD = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*?)[ \t]*$/;

/** The header as written: every line `Name: value`, the known names in their order,
 *  each once, `Hatch` a number. Neither the range of that number nor `Target` is judged
 *  here — `parseHeader` does both. */
export function readHeader(text: string): HeaderLines {
  const lines = text.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first++;
  const head = first < lines.length ? FIELD.exec(lines[first]!) : null;
  if (head === null || head[1]!.toLowerCase() !== 'hatch') {
    return { format: 1, fields: new Map(), endLine: 0, formatLine: 0, targetLine: undefined };
  }

  const fields = new Map<string, string>();
  let last = -1;
  let targetLine: number | undefined;
  let i = first;
  for (; i < lines.length && lines[i]!.trim() !== ''; i++) {
    const field = FIELD.exec(lines[i]!);
    if (field === null) {
      throw new ParseError(
        `a header line must be 'Name: value': '${lines[i]!.trim()}'`,
        i + 1,
        'the header ends at the first blank line — put one before the patch',
      );
    }
    const name = field[1]!;
    const at = fieldPosition(name);
    if (at !== -1) {
      if (fields.has(name.toLowerCase())) throw new ParseError(`the header names ${HEADER_FIELDS[at]} twice`, i + 1);
      if (at < last) {
        throw new ParseError(
          `${HEADER_FIELDS[at]} must come before ${HEADER_FIELDS[last]} in the header`,
          i + 1,
          `the order is ${HEADER_FIELDS.join(', ')}; fields hatch does not know may stand anywhere after Hatch`,
        );
      }
      last = at;
      if (HEADER_FIELDS[at] === 'Target') targetLine = i + 1;
    }
    fields.set(name.toLowerCase(), field[2]!);
  }

  const value = fields.get('hatch')!;
  if (!/^\d+$/.test(value)) throw new ParseError(`Hatch must be a format number: '${value}'`, first + 1);
  return { format: Number(value), fields, endLine: i, formatLine: first + 1, targetLine };
}

/** The header, held to what every reader needs: a format this hatch reads, and a
 *  `Target` that stays inside its root. */
export function parseHeader(text: string): ParsedHeader {
  const header = readHeader(text);
  const side = formatSide(header.format);
  if (side !== undefined) {
    throw new ParseError(
      `the patch is format ${header.format}, this hatch reads ${FORMAT_MIN}–${FORMAT_VERSION}`,
      header.formatLine,
      side === 'newer' ? 'update hatch' : 'regenerate the patch',
    );
  }
  const target = header.fields.get('target');
  if (target !== undefined && !isContainedPath(target)) {
    throw new ParseError(
      `Target must be a relative path inside the project, with no '..': '${target}'`,
      header.targetLine ?? header.formatLine,
    );
  }
  return { format: header.format, fields: header.fields, endLine: header.endLine };
}

/** Which side a format outside the range is on — the side to update (H3) — or undefined
 *  for one this hatch reads. */
export function formatSide(format: number): 'newer' | 'older' | undefined {
  if (format > FORMAT_VERSION) return 'newer';
  if (format < FORMAT_MIN) return 'older';
  return undefined;
}

export function headerFields(parsed: ParsedHeader): HeaderFields {
  const out: HeaderFields = {};
  for (const [name, key] of FIELDS) {
    const value = key === null ? undefined : parsed.fields.get(name.toLowerCase());
    if (key !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** The header `generate` writes, its blank line after it: the fields it has, in the
 *  order of FIELDS. */
export function printHeader(fields: HeaderFields): string {
  const lines = FIELDS.flatMap(([name, key]) => {
    const value = key === null ? String(FORMAT_VERSION) : fields[key];
    return value !== undefined ? [`${name}: ${value}`] : [];
  });
  return `${lines.join('\n')}\n\n`;
}

/** `Target` is data out of a file that may have come with somebody else's repository,
 *  and the path decides what a client opens: it stays inside the root it is measured
 *  from. No `..` step, no absolute path, no Windows drive or UNC — whatever they would
 *  normalise to. */
export function isContainedPath(relPath: string): boolean {
  if (relPath === '') return false;
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(relPath)) return false;
  return !relPath.split(/[\\/]/).includes('..');
}
