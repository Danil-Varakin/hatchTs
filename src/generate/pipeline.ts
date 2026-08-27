import type { Hunk } from '../core/ast.ts';
import type { HunkLink } from '../core/resolve.ts';
import type { InitOptions, LanguageAdapter } from '../lang/source-map.ts';
import type { PartialLimits, Tracer } from './synth.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import { adapterForFile, adapterForLanguage } from '../lang/adapter.ts';
import { changeSegments } from './diff.ts';
import { printHatchFile, trailingSpaceWarnings } from './printer.ts';
import { synthesize } from './synth.ts';

// The whole generate pipeline behind one call, taking TEXT rather than paths. The CLI
// reads files and the service reads a socket; neither difference belongs in here, and
// having one door means an editor cannot drift from what `hatch generate` does.

export interface GenerateRequest {
  readonly oldText: string;
  readonly newText: string;
  /** language name; when absent the adapter is picked from `path` */
  readonly language?: string | undefined;
  readonly path?: string | undefined;
  /** what to write in the `# match <label>` heading (default: language, else adapter) */
  readonly label?: string | undefined;
  readonly exact?: boolean | undefined;
  readonly bridgeGap?: number | undefined;
  readonly limits?: PartialLimits | undefined;
  readonly init?: InitOptions | undefined;
  readonly trace?: Tracer | undefined;
  /** called once per change segment; `total` is known before synthesis starts */
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
  /** a chance to drop hunks before they are printed (the CLI's --agreement) */
  readonly review?: ((hunks: readonly Hunk[]) => Promise<Hunk[]>) | undefined;
  /**
   * Also report where every hunk lands. Costs one resolve pass over the result, so
   * it is off by default: the CLI writes a file and does not need coordinates.
   */
  readonly provenance?: boolean | undefined;
}

export interface GenerateOutcome {
  readonly md: string;
  readonly language: string | undefined;
  readonly hunkCount: number;
  readonly warnings: readonly string[];
  /** present when `provenance` was asked for */
  readonly links?: readonly HunkLink[];
  /** whether applying the result to oldText gives back newText byte for byte */
  readonly reproducesNew?: boolean;
}

export async function generatePatch(request: GenerateRequest): Promise<GenerateOutcome> {
  const adapter = pickAdapter(request);
  await adapter.init(request.init ?? {});

  const bridgeGap = request.bridgeGap ?? 0;
  const trace = withProgress(request, bridgeGap);

  let hunks: readonly Hunk[] = synthesize(request.oldText, request.newText, adapter, {
    bridgeGap,
    ...(request.exact !== undefined ? { exact: request.exact } : {}),
    trace,
    limits: request.limits,
  });
  if (request.review !== undefined) hunks = await request.review(hunks);

  const label = request.label ?? request.language ?? adapter.name;
  const md = printHatchFile(hunks, label);
  const warnings = trailingSpaceWarnings(hunks);

  if (request.provenance !== true) return { md, language: label, hunkCount: hunks.length, warnings };

  // Re-read what we just printed instead of reporting the in-memory hunks: that is the
  // only way to get mdSpan (the printer does not track lines), and it puts the printer
  // and the parser under a round trip on every run.
  const resolved = resolveHunks(request.oldText, parseHatchFile(md), adapter);
  return {
    md,
    language: label,
    hunkCount: hunks.length,
    warnings,
    links: resolved.links,
    reproducesNew: resolved.applied === request.newText,
  };
}

function pickAdapter(request: GenerateRequest): LanguageAdapter {
  if (request.language !== undefined && request.language !== '') return adapterForLanguage(request.language);
  if (request.path !== undefined) return adapterForFile(request.path);
  return adapterForLanguage(undefined); // throws, listing what is supported
}

function withProgress(request: GenerateRequest, bridgeGap: number): Tracer | undefined {
  const { trace, onProgress } = request;
  if (onProgress === undefined) return trace;
  const total = changeSegments(request.oldText, request.newText, bridgeGap).length;
  return (event) => {
    trace?.(event);
    if (event.kind === 'segment') onProgress(event.index + 1, total);
  };
}
