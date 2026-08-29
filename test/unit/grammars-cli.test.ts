import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { registeredGrammars } from '../../src/cli/grammars.ts';
import { formatPin, locate, pinFor } from '../../src/infra/grammar-store.ts';
import { GrammarError } from '../../src/core/errors.ts';

const CLI = fileURLToPath(new URL('../../src/cli/grammars.ts', import.meta.url));

function runCli(args: readonly string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ── the pure core ─────────────────────────────────────────────────────────────

test('the grammar registry follows from the language folders, deduplicated by file', () => {
  const all = registeredGrammars();
  assert.equal(all.length, 11);
  assert.equal(new Set(all.map((g) => g.grammar.file)).size, 11);
  for (const { grammar } of all) {
    assert.match(grammar.sha256!, /^[0-9a-f]{64}$/, grammar.file);
    assert.match(grammar.version!, /^\d+\.\d+\.\d+$/, grammar.file);
  }
  assert.equal(registeredGrammars('go').length, 1);
  assert.equal(registeredGrammars('nosuchlanguage').length, 0);
});

test('locate finds the file in HATCH_GRAMMAR_DIR', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-gdir-'));
  writeFileSync(join(dir, 'tree-sitter-fake.wasm'), new Uint8Array([1]));
  const saved = process.env['HATCH_GRAMMAR_DIR'];
  process.env['HATCH_GRAMMAR_DIR'] = dir;
  try {
    const at = await locate({ file: 'tree-sitter-fake.wasm', package: 'p', version: '1', sha256: 'a'.repeat(64) });
    assert.equal(at, join(dir, 'tree-sitter-fake.wasm'));
  } finally {
    if (saved === undefined) delete process.env['HATCH_GRAMMAR_DIR'];
    else process.env['HATCH_GRAMMAR_DIR'] = saved;
  }
});

test('formatPin prints exactly the block that goes into index.ts', () => {
  const text = formatPin({ file: 'tree-sitter-go.wasm', package: 'tree-sitter-go', version: '0.25.0', sha256: 'ab' });
  assert.match(text, /^ {2}grammar: \{$/m);
  assert.match(text, /file: 'tree-sitter-go\.wasm',/);
  assert.match(text, /sha256: 'ab',/);
});

test('pinFor reads the spec BEFORE going online, so junk fails at once', async () => {
  await assert.rejects(pinFor('noversion'), GrammarError);
});

// ── the shell ─────────────────────────────────────────────────────────────────

test('CLI grammars: --help prints the usage and exits 0', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /hatch grammars/);
  assert.match(r.stdout, /--pin/);
});

test('CLI grammars: an unknown argument is code 1 and the usage on stderr', () => {
  const r = runCli(['--nosuchflag']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown argument/);
});

test('CLI grammars: --list fetches nothing and shows MISSING on an empty cache', () => {
  const cache = mkdtempSync(join(tmpdir(), 'hatch-cache-'));
  const empty = mkdtempSync(join(tmpdir(), 'hatch-empty-'));
  const r = runCli(['--list', '--language', 'go'], {
    HATCH_GRAMMAR_CACHE: cache,
    HATCH_GRAMMAR_DIR: empty,
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /tree-sitter-go\.wasm/);
  assert.match(r.stdout, /MISSING/);
});

test('CLI grammars: an unknown language is code 1, not a quiet empty run', () => {
  const r = runCli(['--language', 'cobol']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown language/);
});
