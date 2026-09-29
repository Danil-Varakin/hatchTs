import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_FILE_NAME,
  CONFIG_MIN,
  CONFIG_VERSION,
  FIELDS,
  configTemplate,
  fieldsOf,
  readConfigFile,
  schemaUrl,
  schemaVersions,
  suggestedConfigPath,
} from '../../src/infra/config/index.ts';
import type { FieldSpec } from '../../src/infra/config/index.ts';
import { checkKeysOf } from '../../src/infra/config/schema.ts';
import { olderSchemaNote } from '../../src/cli/init.ts';
import { ConfigError } from '../../src/core/errors.ts';

const CLI = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

function withTempDir(body: (dir: string) => void): () => void {
  return () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatch-init-')));
    try {
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** A value of each kind that is NOT the default, so reading it back proves it came from the file. */
function sample(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'boolean':
      return true;
    case 'count':
      return 7;
    case 'countOrAll':
      return 'all';
    case 'stringOrNull':
      return spec.key === 'out' ? 'patches/' : 'cpp';
  }
}

function nested(specs: readonly FieldSpec[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const spec of specs) {
    const parts = spec.path.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = sample(spec);
  }
  return root;
}

function readBack(text: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-tpl-'));
  try {
    const file = join(dir, CONFIG_FILE_NAME);
    writeFileSync(file, text);
    return readConfigFile(file) as Record<string, unknown>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('template → loader → the same settings, for every version in the range', () => {
  for (let v = CONFIG_MIN; v <= CONFIG_VERSION; v++) {
    const specs = fieldsOf(v);
    const expected = Object.fromEntries(specs.map((s) => [s.key, sample(s)]));

    const full = configTemplate({ version: v, settings: nested(specs) });
    assert.equal(full.version, v);
    assert.deepEqual(readBack(full.text), expected, `v${v}, nested`);

    const dotted = Object.fromEntries(specs.map((s) => [s.path, sample(s)]));
    assert.equal(configTemplate({ version: v, settings: dotted }).text, full.text, `v${v}, dotted = nested`);

    assert.deepEqual(readBack(configTemplate({ version: v }).text), {}, `v${v}, minimal`);
  }
});

test('the minimal template is $schema and version only, 2-space JSON with a final newline', () => {
  const { text, version } = configTemplate();
  assert.equal(version, CONFIG_VERSION);
  assert.equal(text, `{\n  "$schema": "${schemaUrl(CONFIG_VERSION)}",\n  "version": ${CONFIG_VERSION}\n}\n`);
});

test('keys come out in schema order, whatever order they were given in', () => {
  const { text } = configTemplate({ settings: { 'generate.siblings.max': 2, generate: { exact: true, out: 'p/' } } });
  const order = ['"$schema"', '"version"', '"generate"', '"out"', '"exact"', '"siblings"', '"max"'];
  const at = order.map((k) => text.indexOf(k));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('a key not in the chosen version: ONE error naming every such key and where each belongs', () => {
  assert.throws(
    () => configTemplate({ settings: { generate: { nope: 1, exact: true, parents: { deep: 2 } }, top: 1 } }),
    (e: unknown) => {
      assert.ok(e instanceof ConfigError);
      for (const key of ['generate.nope', 'generate.parents.deep', 'top']) assert.match(e.message, new RegExp(`${key} \\(no such key\\)`));
      assert.doesNotMatch(e.message, /generate\.exact \(/);
      assert.deepEqual(e.detail()?.['version'], CONFIG_VERSION);
      assert.equal((e.detail()?.['keys'] as unknown[]).length, 3);
      return true;
    },
  );
  // A key that exists, but from a later schema, says since when — version 0 has none.
  assert.throws(
    () => checkKeysOf(['generate.out', 'generate.exact'], 0, undefined),
    /not in config schema v0: generate\.out \(since v1\), generate\.exact \(since v1\)/,
  );
});

test('values are checked as the loader checks them, pairs included', () => {
  assert.throws(() => configTemplate({ settings: { generate: { bridgeGap: -1 } } }), /generate\.bridgeGap/);
  assert.throws(() => configTemplate({ settings: { generate: { mirror: true } } }), /needs an output root/);
  assert.throws(() => configTemplate({ settings: [] }), /settings must be an object/);
});

test('C5: a version outside the range names the side to update', () => {
  assert.throws(() => configTemplate({ version: CONFIG_VERSION + 1 }), /does not know yet .*update hatch/);
  assert.throws(() => configTemplate({ version: CONFIG_MIN - 1 }), /no longer reads .*move the file to v/);
  assert.throws(() => configTemplate({ version: '1' }), /must be a whole number/);
});

test('the loader holds a file to the keys of the version it names', () => {
  assert.throws(() => readBack('{ "version": 0, "generate": { "exact": true } }'), ConfigError);
  assert.deepEqual(readBack('{ "generate": { "exact": true } }'), { exact: true }, 'no version: the newest');
});

test('every version has a one-line summary naming each of its keys; mirror is marked', () => {
  const versions = schemaVersions();
  assert.deepEqual(versions.map((v) => v.version), Array.from({ length: CONFIG_VERSION - CONFIG_MIN + 1 }, (_, i) => CONFIG_MIN + i));
  for (const { version, summary } of versions) {
    assert.ok(summary.startsWith(`v${version}: `));
    assert.ok(!summary.includes('\n'));
    for (const f of fieldsOf(version)) assert.ok(summary.includes(f.path.split('.').slice(1).join('.')), f.path);
  }
  assert.match(schemaVersions()[0]!.summary, /mirror \(added in 0\.2\.0 without a bump\)/);
  assert.ok(FIELDS.every((f) => Number.isInteger(f.since) && f.since >= 1));
});

test('suggestedConfigPath: the repository root, outside one the directory itself', withTempDir((dir) => {
  mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
  mkdirSync(join(dir, 'repo', 'src', 'deep'), { recursive: true });
  assert.equal(suggestedConfigPath(join(dir, 'repo', 'src', 'deep')), join(dir, 'repo', CONFIG_FILE_NAME));
  mkdirSync(join(dir, 'loose'));
  assert.equal(suggestedConfigPath(join(dir, 'loose')), join(dir, 'loose', CONFIG_FILE_NAME));
}));

// ── hatch init ──────────────────────────────────────────────────────────────────

function init(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', CLI, 'init', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('hatch init --dry-run prints the template and writes nothing', withTempDir((dir) => {
  const r = init(['--dry-run'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, configTemplate().text);
  assert.throws(() => readFileSync(join(dir, CONFIG_FILE_NAME)));
}));

test('hatch init writes at the git root from a subdirectory', withTempDir((dir) => {
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'a', 'b'), { recursive: true });
  const r = init([], join(dir, 'a', 'b'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, CONFIG_FILE_NAME), 'utf8'), configTemplate().text);
}));

test('hatch init: an existing file is kept without --force (exit 5), replaced with it', withTempDir((dir) => {
  const file = join(dir, CONFIG_FILE_NAME);
  writeFileSync(file, 'mine');
  const refused = init(['--dir', dir], dir);
  assert.equal(refused.status, 5);
  assert.match(refused.stderr, /already exists/);
  assert.equal(readFileSync(file, 'utf8'), 'mine');

  const forced = init(['--dir', dir, '--force'], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(file, 'utf8'), configTemplate().text);
}));

test('hatch init --config-version outside the range: exit 5, the side to update', withTempDir((dir) => {
  const r = init(['--config-version', String(CONFIG_VERSION + 1), '--dry-run'], dir);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /update hatch/);
}));

test('an older schema written gets one line saying so; the newest none', () => {
  assert.equal(olderSchemaNote(CONFIG_VERSION), undefined);
  assert.equal(olderSchemaNote(CONFIG_VERSION - 1), `wrote config schema v${CONFIG_VERSION - 1}; the newest is v${CONFIG_VERSION}`);
});
