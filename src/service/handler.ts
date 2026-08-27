import type { LanguageAdapter } from '../lang/source-map.ts';
import type { ResolveResult } from '../core/resolve.ts';
import type {
  ApplyParams,
  ApplyResultMessage,
  GenerateParams,
  GenerateResult,
  LanguageParams,
  ProgressMessage,
  RequestMessage,
  ResolveParams,
  ResolveResultMessage,
  ResponseMessage,
  ServiceError,
  VersionResult,
} from './protocol.ts';
import { PROTOCOL_VERSION } from './protocol.ts';
import { parseHatchFile } from '../core/hatch-parser.ts';
import { resolveHunks } from '../core/resolve.ts';
import {
  AmbiguityError,
  ConfigError,
  GrammarError,
  HatchError,
  MatchError,
  ParseError,
} from '../core/errors.ts';
import { generatePatch } from '../generate/pipeline.ts';
import { adapterForFile, adapterForLanguage, supportedLanguages } from '../lang/adapter.ts';
import { CONFIG_VERSION } from '../infra/config/schema.ts';
import { packageIdentity } from '../infra/version.ts';
import { downloadAllowedByEnv } from '../infra/grammar-store.ts';

// The service is a shell, exactly like the CLI: it decodes a request, calls the same
// pipeline the CLI calls, and encodes the answer. Anything it would be tempted to
// compute itself belongs one layer down, where the CLI can reach it too.

export type Emit = (message: ProgressMessage) => void;

export async function handle(message: RequestMessage, emit?: Emit): Promise<ResponseMessage> {
  const id = typeof message.id === 'number' ? message.id : 0;
  try {
    return { id, ok: true, result: await dispatch(message, id, emit) };
  } catch (e) {
    return { id, ok: false, error: toServiceError(e) };
  }
}

async function dispatch(message: RequestMessage, id: number, emit: Emit | undefined): Promise<unknown> {
  switch (message.method) {
    case 'version':
      return version();
    case 'generate':
      return generate(params<GenerateParams>(message), id, emit);
    case 'resolve':
      return resolve(params<ResolveParams>(message));
    case 'apply':
      return apply(params<ApplyParams>(message));
    default:
      throw new BadRequest(
        `unknown method '${String(message.method)}'; known: version, generate, resolve, apply`,
      );
  }
}

function version(): VersionResult {
  return {
    hatch: packageIdentity().version,
    protocol: PROTOCOL_VERSION,
    configSchema: CONFIG_VERSION,
    languages: supportedLanguages,
  };
}

async function generate(p: GenerateParams, id: number, emit: Emit | undefined): Promise<GenerateResult> {
  text(p.baseText, 'baseText');
  text(p.newText, 'newText');

  const outcome = await generatePatch({
    oldText: p.baseText,
    newText: p.newText,
    language: p.language,
    path: p.path,
    exact: p.exact,
    bridgeGap: p.bridgeGap,
    limits: p.limits,
    init: grammarPolicy(p),
    provenance: true,
    ...(emit !== undefined
      ? { onProgress: (done: number, total: number) => emit({ method: 'progress', params: { id, done, total } }) }
      : {}),
  });

  return {
    md: outcome.md,
    language: outcome.language,
    warnings: outcome.warnings,
    hunks: outcome.links ?? [],
    reproducesNew: outcome.reproducesNew === true,
  };
}

async function resolve(p: ResolveParams): Promise<ResolveResultMessage> {
  const { links } = await resolveRequest(p);
  return { hunks: links };
}

async function apply(p: ApplyParams): Promise<ApplyResultMessage> {
  const { links, applied } = await resolveRequest(p);
  return { text: applied, hunks: links };
}

async function resolveRequest(p: ResolveParams): Promise<ResolveResult> {
  text(p.md, 'md');
  text(p.baseText, 'baseText');
  const file = parseHatchFile(p.md);
  const adapter = await ready(p, file.language);
  return resolveHunks(p.baseText, file, adapter);
}

async function ready(p: LanguageParams, fromHeading: string | undefined): Promise<LanguageAdapter> {
  const named = p.language ?? fromHeading;
  const adapter =
    named !== undefined && named !== ''
      ? adapterForLanguage(named)
      : p.path !== undefined
        ? adapterForFile(p.path)
        : adapterForLanguage(undefined); // throws, listing what is supported
  await adapter.init(grammarPolicy(p));
  return adapter;
}

function grammarPolicy(p: LanguageParams): { allowDownload: boolean; log: (m: string) => void } {
  return {
    allowDownload: p.allowDownload === true || downloadAllowedByEnv(),
    // stdout belongs to the protocol; anything else goes to stderr
    log: (m: string) => process.stderr.write(`${m}\n`),
  };
}

// ── request decoding ─────────────────────────────────────────────────────────────

class BadRequest extends Error {}

function params<T>(message: RequestMessage): T {
  const p = message.params;
  if (p === null || typeof p !== 'object') {
    throw new BadRequest(`method '${message.method}' needs params`);
  }
  return p as T;
}

function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new BadRequest(`params.${name} must be a string`);
}

// ── error encoding ───────────────────────────────────────────────────────────────

function toServiceError(e: unknown): ServiceError {
  if (e instanceof BadRequest) {
    return { kind: 'BadRequest', message: e.message, exitCode: 1 };
  }
  if (e instanceof HatchError) {
    const detail = detailOf(e);
    return {
      kind: e.name,
      message: e.message,
      exitCode: e.exitCode,
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  return {
    kind: e instanceof Error ? e.name : 'Error',
    message: e instanceof Error ? e.message : String(e),
    exitCode: 1,
  };
}

function detailOf(e: HatchError): Record<string, unknown> | undefined {
  if (e instanceof ParseError) {
    return { mdLine: e.mdLine, ...(e.hint !== undefined ? { hint: e.hint } : {}) };
  }
  if (e instanceof MatchError) {
    return {
      failedStepIndex: e.failedStepIndex,
      ...(e.totalSteps !== undefined ? { totalSteps: e.totalSteps } : {}),
      ...(e.origPos !== undefined ? { origPos: e.origPos } : {}),
      ...(e.anchorText !== undefined ? { anchorText: e.anchorText } : {}),
    };
  }
  if (e instanceof AmbiguityError) return { positions: e.positions };
  if (e instanceof GrammarError) return e.grammar !== undefined ? { grammar: e.grammar } : undefined;
  if (e instanceof ConfigError) return e.file !== undefined ? { file: e.file } : undefined;
  return undefined;
}
