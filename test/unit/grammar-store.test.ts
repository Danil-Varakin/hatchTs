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

test('the URL follows from package and version; an explicit url wins', () => {
  const urls = grammarUrls(SOURCE);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.startsWith('https://')));
  assert.ok(urls[0]!.includes('tree-sitter-nonesuch@1.2.3/tree-sitter-nonesuch.wasm'));

  const custom = { ...SOURCE, url: 'https://example.invalid/g.wasm' };
  assert.deepEqual(grammarUrls(custom), ['https://example.invalid/g.wasm']);
});

test('cache: HATCH_GRAMMAR_CACHE wins, XDG is honoured, a scope adds no nesting', async () => {
  await withEnv({ HATCH_GRAMMAR_CACHE: '/tmp/xx' }, async () => {
    assert.equal(grammarCacheDir(), '/tmp/xx');
  });
  await withEnv({ HATCH_GRAMMAR_CACHE: undefined, XDG_CACHE_HOME: '/tmp/xdg' }, async () => {
    assert.equal(grammarCacheDir(), join('/tmp/xdg', 'hatch', 'grammars'));
  });
  await withEnv({ HATCH_GRAMMAR_CACHE: '/tmp/xx' }, async () => {
    const scoped = { ...SOURCE, package: '@tree-sitter-grammars/tree-sitter-kotlin' };
    assert.equal(
      cacheEntry(scoped),
      join('/tmp/xx', '@tree-sitter-grammars+tree-sitter-kotlin@1.2.3', 'tree-sitter-nonesuch.wasm'),
    );
  });
});

test('without permission it refuses instead of fetching, naming the command and code 6', async () => {
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

test('the message names the LANGUAGE and gives the command for exactly it', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'hatch-cache-'));
  await withEnv({ HATCH_GRAMMAR_CACHE: cache, HATCH_GRAMMAR_DIR: undefined }, async () => {
    const e = await resolveGrammar(SOURCE, {}, 'cpp').then(
      () => null,
      (err: unknown) => err as GrammarError,
    );
    assert.ok(e instanceof GrammarError);
    assert.match(e.message, /the cpp grammar is not installed/);
    assert.match(e.message, /--language cpp/);
    assert.match(e.message, /npm run grammars -- --language cpp/);
  });
});

test('with no language given the message still works, just without it', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'hatch-cache-'));
  await withEnv({ HATCH_GRAMMAR_CACHE: cache, HATCH_GRAMMAR_DIR: undefined }, async () => {
    const e = await resolveGrammar(SOURCE).then(
      () => null,
      (err: unknown) => err as GrammarError,
    );
    assert.ok(e instanceof GrammarError);
    assert.match(e.message, new RegExp(`grammar ${SOURCE.file.replace('.', '\\.')} is not installed`));
    assert.doesNotMatch(e.message, /--language undefined/);
  });
});

test('HATCH_GRAMMAR_DIR hands the file over as is: your build, your checksum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hatch-grammars-'));
  const bytes = new Uint8Array([1, 2, 3]);
  await writeFile(join(dir, SOURCE.file), bytes);
  await withEnv({ HATCH_GRAMMAR_DIR: dir }, async () => {
    const got = await resolveGrammar(SOURCE);
    assert.deepEqual(new Uint8Array(got as Uint8Array), bytes);
  });
});

test('a broken cache entry is IGNORED, its checksum being known, not used', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'hatch-cache-'));
  const entry = cacheEntry({ ...SOURCE });
  await withEnv({ HATCH_GRAMMAR_CACHE: cache, HATCH_GRAMMAR_DIR: undefined }, async () => {
    const path = cacheEntry(SOURCE);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, new Uint8Array([9, 9, 9]));
    await assert.rejects(resolveGrammar(SOURCE), GrammarError);
  });
  assert.ok(entry.length > 0);
});

test('a source with no pin is not accepted at all', async () => {
  await assert.rejects(
    resolveGrammar({ file: 'x.wasm', package: 'p', version: '1' }),
    /sha256/,
  );
  await assert.rejects(resolveGrammar({ file: 'x.wasm', path: 'relative/x.wasm' }), /absolute/);
});
