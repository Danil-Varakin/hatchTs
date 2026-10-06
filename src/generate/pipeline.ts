import type { Hunk } from '../core/ast.ts';
import type { HunkLink } from '../core/resolve.ts';
import type { InitOptions, MapCache } from '../lang/source-map.ts';
import type { PartialLimits, Tracer } from './synth.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import { checkHeading, pickAdapter } from '../lang/adapter.ts';
import { printHatchFile, trailingSpaceWarnings, trailingSpaceWarningsAt } from './printer.ts';
import type { HunkWarning } from './printer.ts';
import { NoChanges } from '../core/errors.ts';
import { printHeader } from '../core/header.ts';
import type { GrammarSource } from '../lang/source-map.ts';
import { packageIdentity } from '../infra/version.ts';
import { synthesizeAsync } from './synth.ts';
import { steerSynthesis } from './steer.ts';
import type { Steering } from './steer.ts';

export interface GenerateRequest {
  readonly oldText: string;
  readonly newText: string;
  readonly language?: string | undefined;
  readonly path?: string | undefined;
  readonly label?: string | undefined;
  readonly exact?: boolean | undefined;
  readonly bridgeGap?: number | undefined;
  readonly limits?: PartialLimits | undefined;
  readonly init?: InitOptions | undefined;
  readonly trace?: Tracer | undefined;
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
  /** After synthesis, the hunks to keep. Kept for API callers; `steering` is the way a
   *  person takes part now — asked hunk by hunk, with an editor. */
  readonly review?: ((hunks: readonly Hunk[]) => Promise<Hunk[]>) | undefined;
  /** Synthesis a person steers (`generate/steer.ts`): asked about each hunk as it is
   *  made, and handed the editor when a change cannot be anchored. */
  readonly steering?: Steering | undefined;
  readonly provenance?: boolean | undefined;
  /** The header's `Target` (`core/header.ts`): the path of the file, already measured
   *  from the root a reader measures it from; no `Target` without it. */
  readonly target?: string | undefined;
  /** The header's `Generated-From`: the id of the git object the base was read from;
   *  none for a base that did not come out of git. */
  readonly generatedFrom?: string | undefined;
  /** Stops the run between two changes, throwing the signal's reason. A person steering
   *  stops it at the terminal instead. */
  readonly signal?: AbortSignal | undefined;
}

export interface GenerateOutcome {
  readonly md: string;
  readonly language: string | undefined;
  readonly hunkCount: number;
  readonly warnings: readonly string[];
  /** the warnings about one hunk, each with the line of `md` it is about */
  readonly warningsAt: readonly HunkWarning[];
  readonly links?: readonly HunkLink[];
  readonly reproducesNew?: boolean;
}

export async function generatePatch(request: GenerateRequest): Promise<GenerateOutcome> {
  const adapter = pickAdapter({ language: request.language, path: request.path });
  // The heading names the language by its own name (`cpp`, `objc`, `python`), however it
  // was picked — `--language c++`, a `.mm` file, a config: the same patch from the CLI and
  // from the service. `label` overrides it for an API caller, and is held to the check.
  const label = request.label ?? adapter.name;
  checkHeading(label, adapter);
  if (unchanged(request, (line) => adapter.normalize(line))) {
    throw new NoChanges(
      request.exact === true
        ? 'the new version is the base, byte for byte — no patch to write'
        : 'the new version is the base once normalized (spacing, blank lines) — no patch to write',
    );
  }
  await adapter.init(request.init ?? {});
  request.signal?.throwIfAborted();

  const bridgeGap = request.bridgeGap ?? 0;
  const trace = withProgress(request);
  const maps: MapCache = new Map();

  let hunks: readonly Hunk[];
  const warnings: string[] = [];
  if (request.steering !== undefined) {
    const steered = await steerSynthesis(
      {
        oldText: request.oldText,
        newText: request.newText,
        adapter,
        label,
        bridgeGap,
        exact: request.exact ?? false,
        limits: request.limits,
        trace,
        maps,
      },
      request.steering,
    );
    hunks = steered.hunks;
    if (!steered.reproducesNew) {
      warnings.push('the patch does not give the new version: changes were left out, or hunks edited by hand make it differ');
    }
  } else {
    hunks = await synthesizeAsync(request.oldText, request.newText, adapter, {
      bridgeGap,
      ...(request.exact !== undefined ? { exact: request.exact } : {}),
      trace,
      limits: request.limits,
      maps,
      signal: request.signal,
    });
    if (request.review !== undefined) hunks = await request.review(hunks);
  }

  const printed = printHatchFile(hunks, label);
  const header = printHeader({
    target: request.target,
    generatedFrom: request.generatedFrom,
    generatedBy: `hatch ${packageIdentity().version}`,
    grammar: grammarName(adapter.grammar),
  });
  const md = header + printed;
  warnings.push(...trailingSpaceWarnings(hunks));
  const warningsAt = trailingSpaceWarningsAt(hunks, md);

  if (request.provenance !== true) return { md, language: label, hunkCount: hunks.length, warnings, warningsAt };
  request.signal?.throwIfAborted();

  const resolved = resolveHunks(request.oldText, parseHatchFile(md), adapter, maps);
  return {
    md,
    language: label,
    hunkCount: hunks.length,
    warnings,
    warningsAt,
    links: resolved.links,
    reproducesNew: resolved.applied === request.newText,
  };
}

/** The first question, before a grammar is loaded or a hunk is looked for. Without
 *  `exact` a change is one synthesis would have to write: each line as the language
 *  normalizes it, blank lines not counted — spacing and empty lines alone are no change.
 *  With `exact`, byte for byte. */
function unchanged(request: GenerateRequest, normalize: (raw: string) => string): boolean {
  if (request.oldText === request.newText) return true;
  if (request.exact === true) return false;
  const significant = (text: string): string[] =>
    text.split(/\r?\n/).map(normalize).filter((line) => line !== '');
  const a = significant(request.oldText);
  const b = significant(request.newText);
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/** `<package>@<version>` as the adapter pins it; the file name for a grammar with no
 *  package behind it. */
function grammarName(grammar: GrammarSource): string {
  return grammar.package !== undefined && grammar.version !== undefined
    ? `${grammar.package}@${grammar.version}`
    : grammar.file;
}

function withProgress(request: GenerateRequest): Tracer | undefined {
  const { trace, onProgress } = request;
  if (onProgress === undefined) return trace;
  return (event) => {
    trace?.(event);
    if (event.kind === 'segment') onProgress(event.index + 1, event.total);
  };
}
