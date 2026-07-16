// lang/adapter.ts — ЗАКРЫТЫЙ реестр адаптеров (whitelist). Единственная точка, где
// имя языка (из fence ```lang или из --language) или расширение файла превращается
// в адаптер. НИКАКОГО динамического import() по строке из недоверенного .md: только
// этот статический список. Добавить язык = импортировать его адаптер и дописать
// две строки ниже (реестр + синонимы имени). Пошагово — docs/adapter-layer.md.
import type { LanguageAdapter } from './source-map.ts';
import { cppAdapter } from './cpp/index.ts';
// import { pythonAdapter } from './python/index.ts';   // TODO(phase-5)

// Все поддерживаемые адаптеры. Порядок важен для adapterForFile: первый с
// подходящим расширением выигрывает (пересечений расширений сейчас нет).
const REGISTRY: readonly LanguageAdapter[] = [
  cppAdapter,
  // pythonAdapter,
];

// Синонимы имени языка (из fence / --language) → адаптер. Ключи в НИЖНЕМ регистре.
const ALIASES: ReadonlyMap<string, LanguageAdapter> = new Map([
  ['cpp', cppAdapter],
  ['c++', cppAdapter],
  ['cc', cppAdapter],
  ['cxx', cppAdapter],
  ['c', cppAdapter],
  ['h', cppAdapter],
  ['hpp', cppAdapter],
  // ['python', pythonAdapter], ['py', pythonAdapter],
]);

/** Имена языков, которые можно указать в fence или --language. */
export const supportedLanguages: readonly string[] = [...ALIASES.keys()];

/**
 * Имя языка → адаптер. Пустое/undefined — «язык не задан» (укажите в fence или
 * --language); неизвестное — «язык не поддерживается». Оба случая — типичные
 * ошибки пользователя; CLI (phase-3) переводит бросок в код выхода.
 */
export function adapterForLanguage(name: string | undefined): LanguageAdapter {
  if (name === undefined || name.trim() === '') {
    throw new Error(
      `language is not specified: put it in the fence (\`\`\`cpp) or pass --language; ` +
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

/** Путь/имя файла → адаптер по расширению (автоопределение для apply/generate). */
export function adapterForFile(path: string): LanguageAdapter {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
  for (const adapter of REGISTRY) {
    if (adapter.extensions.includes(ext)) return adapter;
  }
  const known = REGISTRY.flatMap((a) => a.extensions).join(', ');
  throw new Error(`no adapter for file extension '${ext || '(none)'}'; known: ${known}`);
}
