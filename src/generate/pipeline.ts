import type { Hunk } from '../core/ast.ts';
import type { HunkLink } from '../core/resolve.ts';
import type { InitOptions, LanguageAdapter, MapCache } from '../lang/source-map.ts';
import type { PartialLimits, Tracer } from './synth.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import { adapterForFile, adapterForLanguage } from '../lang/adapter.ts';
import { printHatchFile, trailingSpaceWarnings } from './printer.ts';
import { synthesize } from './synth.ts';

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
  readonly review?: ((hunks: readonly Hunk[]) => Promise<Hunk[]>) | undefined;
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
  const adapter = pickAdapter(request);
  await adapter.init(request.init ?? {});

  const bridgeGap = request.bridgeGap ?? 0;
  const trace = withProgress(request);
  const maps: MapCache = new Map();

  let hunks: readonly Hunk[] = synthesize(request.oldText, request.newText, adapter, {
    bridgeGap,
    ...(request.exact !== undefined ? { exact: request.exact } : {}),
    trace,
    limits: request.limits,
    maps,
  });
  if (request.review !== undefined) hunks = await request.review(hunks);

  const label = request.label ?? request.language ?? adapter.name;
  const md = printHatchFile(hunks, label);
  const warnings = trailingSpaceWarnings(hunks);

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

function pickAdapter(request: GenerateRequest): LanguageAdapter {
  if (request.language !== undefined && request.language !== '') return adapterForLanguage(request.language);
  if (request.path !== undefined) return adapterForFile(request.path);
  return adapterForLanguage(undefined); // throws, listing what is supported
}

function withProgress(request: GenerateRequest): Tracer | undefined {
  const { trace, onProgress } = request;
  if (onProgress === undefined) return trace;
  return (event) => {
    trace?.(event);
    if (event.kind === 'segment') onProgress(event.index + 1, event.total);
  };
}
