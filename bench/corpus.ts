// The stands the speed cases run on. Synthetic on purpose: a stand has to be the same
// on every machine and in every month, and a checkout of somebody's project is neither.
//
// Two regimes, and they must not be mixed — they differ by orders of magnitude:
//
//   'repeat'   bodies built from calls of the same SHAPE (`list->Add(kFlagN_M)`). A
//              generalized anchor collapses the argument to `...`, so every occurrence
//              reads alike. This is the worst case for the backtracking search.
//   'distinct' every line has a call name of its own, so an anchor is unique from the
//              first rung. Use this one for anything that is not about that worst case.

export type Regime = 'repeat' | 'distinct';

export interface CppFileOptions {
  readonly perBody?: number;
  readonly regime?: Regime;
}

/** A C++ file of `funcs` classes, each with a method whose body nests if/for. */
export function cppFile(funcs: number, options: CppFileOptions = {}): string {
  const perBody = options.perBody ?? 6;
  const regime = options.regime ?? 'distinct';
  const call = (f: number, b: number): string =>
    regime === 'repeat' ? `list->Add(kFlag${f}_${b})` : `Install${f}_${b}(list, opts)`;

  const out: string[] = ['#include "base/feature_list.h"', '#include "base/logging.h"', '', 'namespace content {', ''];
  for (let f = 0; f < funcs; f++) {
    const inNamespace = f % 7 === 0;
    if (inNamespace) out.push(`namespace detail_${f} {`, '');
    out.push(`class Handler${f} : public BaseHandler {`, ' public:');
    out.push(`  void Register${f}(FeatureList* list, const Options& opts) {`);
    for (let b = 0; b < perBody; b++) {
      if (b % 3 === 0) {
        out.push(`    if (opts.enable_${f}_${b}) {`, `      ${call(f, b)};`, `      LOG(INFO) << "flag ${f}.${b}";`, '    }');
      } else if (b % 3 === 1) {
        out.push(`    for (const auto& item : opts.items_${f}_${b}) {`, `      ${call(f, b)};`, '    }');
      } else {
        out.push(`    ${call(f, b)};`);
      }
    }
    out.push('  }', '', `  int Count${f}() const { return count_${f}_; }`, '', ' private:', `  int count_${f}_ = ${f};`, '};', '');
    if (inNamespace) out.push(`}  // namespace detail_${f}`, '');
  }
  out.push('}  // namespace content', '');
  return out.join('\n');
}

/** The same file with `n` edits spread through it: one line added to `n` method bodies. */
export function withEdits(text: string, n: number): { text: string; edits: number } {
  const lines = text.split('\n');
  const targets: number[] = [];
  for (const [i, line] of lines.entries()) if (/^ {4}(list->Add|Install)/.test(line)) targets.push(i);
  const step = Math.max(1, Math.floor(targets.length / n));
  const picked: number[] = [];
  for (let k = 0; k < n && k * step < targets.length; k++) picked.push(targets[k * step]!);
  for (const i of [...picked].reverse()) lines.splice(i + 1, 0, '    EnableNewPath(list);');
  return { text: lines.join('\n'), edits: picked.length };
}

/** One edit at a chosen nesting depth, file size held by `funcs`: tells "grows with the
 *  file" apart from "grows with the number of parents a pattern has to carry". */
export function nested(funcs: number, depth: number): string {
  const out: string[] = ['namespace content {', ''];
  for (let f = 0; f < funcs; f++) {
    let indent = '';
    const closers: string[] = [];
    if (depth >= 1) { out.push(`${indent}class Handler${f} {`, `${indent} public:`); closers.push(`${indent}};`); indent += '  '; }
    if (depth >= 2) { out.push(`${indent}void Register${f}(FeatureList* list, const Options& opts) {`); closers.push(`${indent}}`); indent += '  '; }
    if (depth >= 3) { out.push(`${indent}if (opts.enable_${f}) {`); closers.push(`${indent}}`); indent += '  '; }
    if (depth >= 4) { out.push(`${indent}for (const auto& item : opts.items_${f}) {`); closers.push(`${indent}}`); indent += '  '; }
    out.push(`${indent}Install${f}(list, item);`);
    for (const closer of closers.reverse()) out.push(closer);
    out.push('');
  }
  out.push('}  // namespace content', '');
  return out.join('\n');
}

/** The first call in a `nested` file, duplicated under another name: one edit. */
export function editFirstCall(text: string): string {
  const lines = text.split('\n');
  const i = lines.findIndex((line) => /Install\d+\(/.test(line));
  if (i === -1) throw new Error('corpus: no call to edit');
  lines.splice(i + 1, 0, lines[i]!.replace(/Install\d+\(/, 'EnableNewPath('));
  return lines.join('\n');
}

/** A hunk of the form `generate` settles on: a parent header and its closing token. */
export function patchFor(method: number, body = '      EnableNewPath(list);'): string {
  return `Hatch: 1\n\n# match cpp\n    ...\n    void Register${method}(\n    ...\n    ) {\n    ...\n    >>>\n    }\n    ...\n# end\n# patch\n${body}\n# end\n`;
}
