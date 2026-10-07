// Speed and performance cases, repeatable. NOT part of `npm test`: the heavy ones take
// minutes, and a suite that takes minutes stops being run.
//
//   npm run bench                  every case at its default sizes
//   npm run bench -- --case apply  one case (parse | apply | generate | probes | depth)
//   npm run bench -- --reps 9 --budget 60000 --big
//
// Measured IN PROCESS, through the library API: process start (~0.1 s) and loading the
// grammar are outside the measurement, because what they cost is already known and does
// not move. Recorded numbers do not live here: they go into the backlog, under the one
// item that owns performance (Г3), with the stand each was taken on — a measurement is
// written down there before it is used in an argument. See CLAUDE.md.

import { applyAll } from '../src/core/apply.ts';
import { parseHatchFile } from '../src/core/hatch-parser.ts';
import { printPattern } from '../src/core/hatch-printer.ts';
import { resolveHunks } from '../src/core/resolve.ts';
import { generatePatch } from '../src/generate/pipeline.ts';
import type { SynthEvent } from '../src/generate/synth.ts';
import { cppAdapter } from '../src/lang/cpp/index.ts';
import { cppFile, editFirstCall, nested, patchFor, withEdits } from './corpus.ts';

interface Options {
  readonly case: string | undefined;
  readonly reps: number;
  readonly budgetMs: number;
  readonly big: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const number = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} takes a positive number, not '${raw}'`);
    return n;
  };
  return {
    case: value('--case'),
    reps: number('--reps', 5),
    budgetMs: number('--budget', 20_000),
    big: argv.includes('--big'),
  };
}

const ms = (x: number): string => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${x.toFixed(1)}`);

/** Median of up to `reps` runs after one warm-up. A single run past the budget is
 *  reported alone: the point of the budget is that one case cannot eat the suite. */
async function measure(opts: Options, body: () => Promise<void> | void): Promise<{ median: number; capped: boolean }> {
  const started = performance.now();
  await body();
  const warm = performance.now() - started;
  if (warm > opts.budgetMs) return { median: warm, capped: true };
  const xs: number[] = [];
  for (let i = 0; i < opts.reps; i++) {
    const t = performance.now();
    await body();
    xs.push(performance.now() - t);
  }
  xs.sort((a, b) => a - b);
  return { median: xs[Math.floor(xs.length / 2)]!, capped: false };
}

function row(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
}

async function cell(opts: Options, body: () => Promise<void> | void): Promise<string> {
  const { median, capped } = await measure(opts, body);
  return capped ? `${ms(median)}*` : ms(median);
}

// ── parse: what one tree-sitter parse costs, the floor under apply ────────────────────
async function caseParse(opts: Options): Promise<void> {
  const W = [16, 9, 11] as const;
  console.log(row(['lines', 'KB', 'buildMap'], W));
  for (const funcs of sizes(opts)) {
    const source = cppFile(funcs);
    console.log(row([
      String(source.split('\n').length),
      (source.length / 1024).toFixed(0),
      await cell(opts, () => { cppAdapter.buildMap(source); }),
    ], W));
  }
}

// ── apply: a patch that FITS — the build's case, and sync's ───────────────────────────
async function caseApply(opts: Options): Promise<void> {
  const W = [16, 9, 11, 11, 13, 12] as const;
  console.log(row(['lines', 'KB', 'buildMap', 'apply 1', 'resolve 1', 'apply 10'], W));
  for (const funcs of sizes(opts)) {
    const source = cppFile(funcs);
    const one = parseHatchFile(patchFor(0));
    const stride = Math.max(1, Math.floor(funcs / 10));
    const ten = parseHatchFile(
      `Hatch: 1\n\n${Array.from({ length: 10 }, (_, i) => patchFor(i * stride).split('\n\n').slice(1).join('\n\n')).join('\n')}`,
    );
    console.log(row([
      String(source.split('\n').length),
      (source.length / 1024).toFixed(0),
      await cell(opts, () => { cppAdapter.buildMap(source); }),
      await cell(opts, () => { applyAll(source, one, cppAdapter); }),
      await cell(opts, () => { resolveHunks(source, one, cppAdapter); }),
      await cell(opts, () => { applyAll(source, ten, cppAdapter); }),
    ], W));
  }
}

// ── generate: synthesis, the one that does not scale ──────────────────────────────────
async function caseGenerate(opts: Options): Promise<void> {
  const W = [16, 9, 8, 11, 12] as const;
  console.log(row(['lines', 'KB', 'edits', 'generate', 'per edit'], W));
  for (const regime of ['distinct', 'repeat'] as const) {
    console.log(`\n  regime: ${regime}`);
    for (const funcs of sizes(opts)) {
      const oldText = cppFile(funcs, { regime });
      const { text: newText, edits } = withEdits(oldText, 3);
      const { median, capped } = await measure(opts, async () => {
        await generatePatch({ oldText, newText, language: 'cpp' });
      });
      console.log(row([
        String(oldText.split('\n').length),
        (oldText.length / 1024).toFixed(0),
        String(edits),
        capped ? `${ms(median)}*` : ms(median),
        ms(median / edits),
      ], W));
      if (median > opts.budgetMs * 2) { console.log('  (stopping this regime: past twice the budget)'); break; }
    }
  }
}

// ── probes: WHERE synthesis spends it — how many probes, and the worst one ────────────
async function caseProbes(opts: Options): Promise<void> {
  const W = [16, 8, 11, 13, 11] as const;
  console.log(row(['lines', 'probes', 'total', 'worst probe', 'its result'], W));
  let worstPattern = '';
  for (const funcs of sizes(opts)) {
    const oldText = cppFile(funcs);
    const { text: newText } = withEdits(oldText, 3);
    let probes = 0;
    let worst = 0;
    let worstResult = '';
    let last = performance.now();
    const trace = (event: SynthEvent): void => {
      const now = performance.now();
      if (event.kind === 'attempt') {
        probes++;
        if (now - last > worst) {
          worst = now - last;
          worstResult = `${event.result}/${event.matches}`;
          worstPattern = printPattern(event.pattern).split('\n').join(' / ');
        }
      }
      last = now;
    };
    const started = performance.now();
    await generatePatch({ oldText, newText, language: 'cpp', trace });
    const total = performance.now() - started;
    console.log(row([String(oldText.split('\n').length), String(probes), ms(total), ms(worst), worstResult], W));
    if (total > opts.budgetMs * 2) break;
  }
  if (worstPattern !== '') console.log(`\n  worst pattern: ${worstPattern.slice(0, 200)}`);
}

// ── depth: one edit, nesting 1..4 — the control that says size alone is innocent ──────
async function caseDepth(opts: Options): Promise<void> {
  const counts = opts.big ? [25, 50, 100, 200, 400] : [25, 50, 100, 200];
  const W = [16, ...counts.map(() => 9)] as const;
  console.log(row(['depth \\ classes', ...counts.map(String)], W));
  for (const depth of [1, 2, 3, 4]) {
    const cells: string[] = [];
    for (const funcs of counts) {
      const oldText = nested(funcs, depth);
      const newText = editFirstCall(oldText);
      cells.push(await cell(opts, async () => { await generatePatch({ oldText, newText, language: 'cpp' }); }));
    }
    console.log(row([String(depth), ...cells], W));
  }
  console.log(`\n  (lines at the widest: ${nested(counts[counts.length - 1]!, 4).split('\n').length})`);
}

function sizes(opts: Options): number[] {
  return opts.big ? [10, 25, 50, 100, 300, 600] : [10, 25, 50, 100];
}

const CASES = new Map<string, (opts: Options) => Promise<void>>([
  ['parse', caseParse],
  ['apply', caseApply],
  ['generate', caseGenerate],
  ['probes', caseProbes],
  ['depth', caseDepth],
]);

export async function main(argv: readonly string[]): Promise<void> {
  const opts = parseOptions(argv);
  const chosen = opts.case === undefined ? [...CASES.keys()] : [opts.case];
  for (const name of chosen) {
    if (!CASES.has(name)) throw new Error(`unknown case '${name}' — one of ${[...CASES.keys()].join(', ')}`);
  }
  await cppAdapter.init();
  console.log(
    `\nhatch bench — synthetic C++, Node ${process.versions.node}, ${process.platform}-${process.arch}\n` +
      `up to ${opts.reps} runs after a warm-up, median; budget ${opts.budgetMs / 1000} s per cell ` +
      `(* = one run, past the budget); times in ms unless marked s\n`,
  );
  for (const name of chosen) {
    console.log(`\n── ${name} ──`);
    await CASES.get(name)!(opts);
  }
  console.log('');
}
