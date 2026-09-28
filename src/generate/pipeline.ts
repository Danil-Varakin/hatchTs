import type { Hunk } from '../core/ast.ts';
import type { HunkLink } from '../core/resolve.ts';
import type { InitOptions, MapCache } from '../lang/source-map.ts';
import type { PartialLimits, Tracer } from './synth.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import { checkHeading, pickAdapter } from '../lang/adapter.ts';
import { printHatchFile, trailingSpaceWarnings } from './printer.ts';
import { synthesize } from './synth.ts';
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
}

export interface GenerateOutcome {
  readonly md: string;
  readonly language: string | undefined;
  readonly hunkCount: number;
  readonly warnings: readonly string[];
  readonly links?: readonly HunkLink[];
  readonly reproducesNew?: boolean;
}

export async function generatePatch(request: GenerateRequest): Promise<GenerateOutcome> {
  const adapter = pickAdapter({ language: request.language, path: request.path });
  // The heading names the language by its own name (`cpp`, `objc`, `python`), however it
  // was picked — `--language c++`, a `.mm` file, a config: the same .md from the CLI and
  // from the service. `label` overrides it for an API caller, and is held to the check.
  const label = request.label ?? adapter.name;
  checkHeading(label, adapter);
  await adapter.init(request.init ?? {});

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
      warnings.push('the .md does not give the new version: changes were left out, or hunks edited by hand make it differ');
    }
  } else {
    hunks = synthesize(request.oldText, request.newText, adapter, {
      bridgeGap,
      ...(request.exact !== undefined ? { exact: request.exact } : {}),
      trace,
      limits: request.limits,
      maps,
    });
    if (request.review !== undefined) hunks = await request.review(hunks);
  }

  const md = printHatchFile(hunks, label);
  warnings.push(...trailingSpaceWarnings(hunks));

  if (request.provenance !== true) return { md, language: label, hunkCount: hunks.length, warnings };

  const resolved = resolveHunks(request.oldText, parseHatchFile(md), adapter, maps);
  return {
    md,
    language: label,
    hunkCount: hunks.length,
    warnings,
    links: resolved.links,
    reproducesNew: resolved.applied === request.newText,
  };
}

function withProgress(request: GenerateRequest): Tracer | undefined {
  const { trace, onProgress } = request;
  if (onProgress === undefined) return trace;
  return (event) => {
    trace?.(event);
    if (event.kind === 'segment') onProgress(event.index + 1, event.total);
  };
}
