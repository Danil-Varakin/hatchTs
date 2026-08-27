import type { LanguageAdapter } from './source-map.ts';
import { cppAdapter } from './cpp/index.ts';
import { cAdapter } from './c/index.ts';
import { objcAdapter } from './objc/index.ts';
import { pythonAdapter } from './python/index.ts';
import { javascriptAdapter } from './javascript/index.ts';
import { typescriptAdapter } from './typescript/index.ts';
import { tsxAdapter } from './tsx/index.ts';
import { rustAdapter } from './rust/index.ts';
import { javaAdapter } from './java/index.ts';
import { kotlinAdapter } from './kotlin/index.ts';
import { goAdapter } from './go/index.ts';

const REGISTRY: readonly LanguageAdapter[] = [
  cppAdapter,
  cAdapter,
  objcAdapter,
  pythonAdapter,
  javascriptAdapter,
  typescriptAdapter,
  tsxAdapter,
  rustAdapter,
  javaAdapter,
  kotlinAdapter,
  goAdapter,
];

const ALIASES: ReadonlyMap<string, LanguageAdapter> = new Map([
  ['cpp', cppAdapter],
  ['c++', cppAdapter],
  ['cc', cppAdapter],
  ['cxx', cppAdapter],
  ['h', cppAdapter],
  ['hpp', cppAdapter],
  ['c', cAdapter],
  ['objc', objcAdapter],
  ['objective-c', objcAdapter],
  ['objectivec', objcAdapter],
  ['objcpp', objcAdapter], 
  ['objective-c++', objcAdapter],
  ['python', pythonAdapter],
  ['py', pythonAdapter],
  ['javascript', javascriptAdapter],
  ['js', javascriptAdapter],
  ['jsx', javascriptAdapter], 
  ['mjs', javascriptAdapter],
  ['cjs', javascriptAdapter],
  ['typescript', typescriptAdapter],
  ['ts', typescriptAdapter],
  ['tsx', tsxAdapter], 
  ['rust', rustAdapter],
  ['rs', rustAdapter],
  ['java', javaAdapter],
  ['kotlin', kotlinAdapter],
  ['kt', kotlinAdapter],
  ['go', goAdapter],
  ['golang', goAdapter],
]);

export const supportedLanguages: readonly string[] = [...ALIASES.keys()];

export function adaptersByName(): ReadonlyMap<string, LanguageAdapter> {
  return ALIASES;
}

export function adapterForLanguage(name: string | undefined): LanguageAdapter {
  if (name === undefined || name.trim() === '') {
    throw new Error(
      `language is not specified: put it in the heading (# match cpp) or pass --language; ` +
        `supported: ${supportedLanguages.join(', ')}`,
    );
  }
  const adapter = ALIASES.get(name.trim().toLowerCase());
  if (adapter === undefined) {
    throw new Error(
      `unsupported language '${name}'; supported: ${supportedLanguages.join(', ')}`,
    );
  }
  return adapter;
}

export function adapterForFile(path: string): LanguageAdapter {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
  for (const adapter of REGISTRY) {
    if (adapter.extensions.includes(ext)) return adapter;
  }
  const known = REGISTRY.flatMap((a) => a.extensions).join(', ');
  throw new Error(`no adapter for file extension '${ext || '(none)'}'; known: ${known}`);
}
