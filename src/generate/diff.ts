import { structuredPatch } from 'diff';

export type LineKind = 'context' | 'del' | 'add' | 'eofnl';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ChangeSegment {
  oldStart: number;
  newStart: number;
  removed: string[];
  added: string[];
}

export function diffHunks(oldStr: string, newStr: string, context = 3): DiffHunk[] {
  const patch = structuredPatch('a', 'b', oldStr, newStr, '', '', { context });
  return patch.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));
}

export function changeSegments(oldStr: string, newStr: string, bridgeGap = 0): ChangeSegment[] {
  const base = baseSegments(oldStr, newStr);
  if (base.length === 0) return [];

  const oldLines = oldStr.split('\n');
  const out: ChangeSegment[] = [];
  let merged = base[0]!;
  for (let i = 1; i < base.length; i++) {
    const next = base[i]!;
    const gapStart = merged.oldStart + merged.removed.length; 
    const gap = oldLines.slice(gapStart - 1, next.oldStart - 1); 
    const nonBlank = gap.filter((line) => line.trim() !== '').length; 
    if (nonBlank <= bridgeGap) {
      merged = {
        oldStart: merged.oldStart,
        newStart: merged.newStart,
        removed: [...merged.removed, ...gap, ...next.removed],
        added: [...merged.added, ...gap, ...next.added],
      };
    } else {
      out.push(merged);
      merged = next;
    }
  }
  out.push(merged);
  return out;
}

function baseSegments(oldStr: string, newStr: string): ChangeSegment[] {
  const segments: ChangeSegment[] = [];
  for (const h of diffHunks(oldStr, newStr, 0)) {
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    let cur: ChangeSegment | null = null;
    const flush = () => {
      if (cur) {
        segments.push(cur);
        cur = null;
      }
    };
    for (const line of h.lines) {
      switch (lineKind(line)) {
        case 'eofnl':
          break; 
        case 'context':
          flush(); 
          oldLine++;
          newLine++;
          break;
        case 'del':
          cur ??= { oldStart: oldLine, newStart: newLine, removed: [], added: [] };
          cur.removed.push(lineText(line));
          oldLine++;
          break;
        case 'add':
          cur ??= { oldStart: oldLine, newStart: newLine, removed: [], added: [] };
          cur.added.push(lineText(line));
          newLine++;
          break;
      }
    }
    flush();
  }
  return segments;
}

export function lineKind(line: string): LineKind {
  switch (line[0]) {
    case '-':
      return 'del';
    case '+':
      return 'add';
    case '\\':
      return 'eofnl';
    case ' ':
      return 'context';
    default:
      return 'context'; 
  }
}

export function lineText(line: string): string {
  return line.slice(1);
}
