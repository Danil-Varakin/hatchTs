// Проверки store БЕЗ СЕТИ: разрешение путей, отказ без разрешения, реакция на битый
// кеш. Скачивание здесь не трогаем намеренно — тест, которому нужен интернет, не тест.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cacheEntry,
  grammarCacheDir,
  grammarUrls,
  resolveGrammar,
} from '../../src/infra/grammar-store.ts';
import { GrammarError } from '../../src/core/errors.ts';

const SHA_A = 'a'.repeat(64);
const SOURCE = {
  file: 'tree-sitter-nonesuch.wasm',
  package: 'tree-sitter-nonesuch',
  version: '1.2.3',
  sha256: SHA_A,
} as const;

// Подменить переменные окружения на время одного теста и вернуть как было.
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('URL выводится из пакета и версии; явный url перекрывает', () => {
  const urls = grammarUrls(SOURCE);
  assert.equal(urls.length, 2); // jsdelivr + запасной unpkg
  assert.ok(urls.every((u) => u.startsWith('https://')));
  assert.ok(urls[0]!.includes('tree-sitter-nonesuch@1.2.3/tree-sitter-nonesuch.wasm'));

  const custom = { ...SOURCE, url: 'https://example.invalid/g.wasm' };
  assert.deepEqual(grammarUrls(custom), ['https://example.invalid/g.wasm']);
});

test('кеш: HATCH_GRAMMAR_CACHE перекрывает, XDG уважается, scope не создаёт вложенность', async () => {
  await withEnv({ HATCH_GRAMMAR_CACHE: '/tmp/xx' }, async () => {
    assert.equal(grammarCacheDir(), '/tmp/xx');
  });
  await withEnv({ HATCH_GRAMMAR_CACHE: undefined, XDG_CACHE_HOME: '/tmp/xdg' }, async () => {
    assert.equal(grammarCacheDir(), join('/tmp/xdg', 'hatch', 'grammars'));
  });
  // '@scope/pkg' → '@scope+pkg': запись остаётся ОДНИМ уровнем, слеш не делает подпапку.
  await withEnv({ HATCH_GRAMMAR_CACHE: '/tmp/xx' }, async () => {
    const scoped = { ...SOURCE, package: '@tree-sitter-grammars/tree-sitter-kotlin' };
    assert.equal(
      cacheEntry(scoped),
      '/tmp/xx/@tree-sitter-grammars+tree-sitter-kotlin@1.2.3/tree-sitter-nonesuch.wasm',
    );
  });
});

test('без разрешения — отказ, а не тихая загрузка; в сообщении есть команда и код 6', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'hatch-cache-'));
  await withEnv({ HATCH_GRAMMAR_CACHE: cache, HATCH_GRAMMAR_DIR: undefined }, async () => {
    const e = await resolveGrammar(SOURCE).then(
      () => null,
      (err: unknown) => err as GrammarError,
    );
    assert.ok(e instanceof GrammarError);
    assert.equal(e.exitCode, 6);
    assert.match(e.message, /npm run grammars/);
    assert.match(e.message, /--download-grammars/);
    assert.match(e.message, /looked in:/);
  });
});

test('HATCH_GRAMMAR_DIR отдаёт файл как есть (своя сборка — своя контрольная сумма)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hatch-grammars-'));
  const bytes = new Uint8Array([1, 2, 3]);
  await writeFile(join(dir, SOURCE.file), bytes);
  await withEnv({ HATCH_GRAMMAR_DIR: dir }, async () => {
    const got = await resolveGrammar(SOURCE);
    assert.deepEqual(new Uint8Array(got as Uint8Array), bytes);
  });
});

test('битая запись кеша ИГНОРИРУЕТСЯ (её хеш мы знаем), а не идёт в дело', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'hatch-cache-'));
  const entry = cacheEntry({ ...SOURCE });
  await withEnv({ HATCH_GRAMMAR_CACHE: cache, HATCH_GRAMMAR_DIR: undefined }, async () => {
    const path = cacheEntry(SOURCE);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, new Uint8Array([9, 9, 9])); // не тот sha256
    // Загрузка запрещена → отказ. Главное: подменённые байты НЕ вернулись.
    await assert.rejects(resolveGrammar(SOURCE), GrammarError);
  });
  assert.ok(entry.length > 0);
});

test('источник без пина не принимается вовсе', async () => {
  await assert.rejects(
    resolveGrammar({ file: 'x.wasm', package: 'p', version: '1' }),
    /sha256/,
  );
  await assert.rejects(resolveGrammar({ file: 'x.wasm', path: 'relative/x.wasm' }), /absolute/);
});
