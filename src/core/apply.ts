import { matchPattern } from './matcher.ts';
import { patchHunk } from './patcher.ts';
import type { Edit } from './patcher.ts';
import type { HatchFile } from './ast.ts';
import type { LanguageAdapter } from '../lang/source-map.ts';

export interface AppliedEdit {
  edit: Edit;
  oldText: string;
}

export interface ApplyResult {
  source: string;
  edits: AppliedEdit[];
}

export function applyAll(source: string, file: HatchFile, adapter: LanguageAdapter): ApplyResult {
  let current = source;
  const edits: AppliedEdit[] = [];
  for (const hunk of file.hunks) {
    const map = adapter.buildMap(current);
    const marks = matchPattern(hunk.match, map, adapter.normalize);
    const result = patchHunk(current, map, marks, hunk.patch);
    edits.push({ edit: result.edit, oldText: current.slice(result.edit.start, result.edit.end) });
    current = result.source;
  }
  return { source: current, edits };
}
