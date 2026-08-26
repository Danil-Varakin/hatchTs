import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  DEFAULT_SETTINGS,
  findConfigFile,
  formatConfig,
  knownConfigKeys,
  loadConfig,
  readConfigFile,
  resolveConfig,
} from '../../src/infra/config/index.ts';
import { ConfigError, MatchError } from '../../src/core/errors.ts';
import { DEFAULT_SYNTH_LIMITS, resolveLimits, synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';

function withTempDir(body: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hatch-cfg-'));
    try {
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function writeConfig(dir: string, body: unknown): string {
  const file = join(dir, CONFIG_FILE_NAME);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

// ── layers ───────────────────────────────────────────────────────────────────────

test('no file and no flags: built-in defaults, every origin is "default"', () => {
  const config = resolveConfig({});
  assert.deepEqual({ ...config.generate }, { ...DEFAULT_SETTINGS });
  assert.equal(config.file, undefined);
  for (const key of knownConfigKeys()) assert.equal(config.origins[key], 'default');
});

test('file overrides defaults, flag overrides file', () => {
  const config = resolveConfig({
    file: '/repo/hatch.config.json',
    fromFile: { maxSiblings: 1, minParents: 2, out: 'patches/' },
    flags: [{ key: 'maxSiblings', value: 0, flag: '--siblings' }],
  });
  assert.equal(config.generate.maxSiblings, 0);
  assert.equal(config.origins['generate.siblings.max'], 'flag --siblings');
  assert.equal(config.generate.minParents, 2);
  assert.equal(config.origins['generate.parents.min'], 'config /repo/hatch.config.json');
  assert.equal(config.generate.parentDetailBase, DEFAULT_SETTINGS.parentDetailBase);
  assert.equal(config.origins['generate.parents.detail.base'], 'default');
});

test('undefined values do not wipe the layer below', () => {
  const config = resolveConfig({
    fromFile: { maxSiblings: undefined, minParents: 3 },
    flags: [{ key: 'minParents', value: undefined, flag: '--min-parents' }],
  });
  assert.equal(config.generate.maxSiblings, DEFAULT_SETTINGS.maxSiblings);
  assert.equal(config.generate.minParents, 3);
});

test('a flag value is validated as strictly as a file value', () => {
  assert.throws(
    () => resolveConfig({ flags: [{ key: 'maxSiblings', value: 'x', flag: '--siblings' }] }),
    (e: unknown) => e instanceof ConfigError && e.exitCode === 5 && /non-negative integer/.test(e.message),
  );
});

test('parents.max accepts "all" and refuses null', () => {
  const all = resolveConfig({ flags: [{ key: 'maxParents', value: 'all', flag: '--parents' }] });
  assert.equal(all.generate.maxParents, 'all');
  assert.throws(() => resolveConfig({ flags: [{ key: 'maxParents', value: null, flag: '--parents' }] }), ConfigError);
});

test('resolveLimits takes only defined keys', () => {
  assert.deepEqual({ ...resolveLimits(undefined) }, { ...DEFAULT_SYNTH_LIMITS });
  const limits = resolveLimits({ maxSiblings: 0, minParents: undefined });
  assert.equal(limits.maxSiblings, 0);
  assert.equal(limits.minParents, DEFAULT_SYNTH_LIMITS.minParents);
});

test('a detail ceiling is no longer a key at all', withTempDir((dir) => {
  // The ceiling went away with the adaptive round (BACKLOG §4.0): unfolding stops when
  // no bracket can tell the candidates apart, so there is nothing left to contradict.
  // A config still carrying the old key must SAY so, not be quietly ignored — which the
  // strict "unknown key" rule already guarantees, and this test pins it to THIS key.
  const file = writeConfig(dir, { version: 1, generate: { parents: { detail: { limit: 2 } } } });
  assert.throws(
    () => readConfigFile(file),
    (e: unknown) => e instanceof ConfigError && /unknown key "generate\.parents\.detail\.limit"/.test(e.message),
  );
}));

test('a minimum above its maximum is a wish, not a contradiction: it gets clamped', () => {
  assert.equal(
    resolveConfig({
      flags: [
        { key: 'minSiblings', value: 5, flag: '--min-siblings' },
        { key: 'maxSiblings', value: 2, flag: '--siblings' },
      ],
    }).generate.minSiblings,
    5,
  );
});

// ── file validation ──────────────────────────────────────────────────────────────

test('an unknown key is an error, not a silent default', withTempDir((dir) => {
  const file = writeConfig(dir, { version: 1, generate: { siblings: { maxx: 3 } } });
  assert.throws(
    () => readConfigFile(file),
    (e: unknown) =>
      e instanceof ConfigError &&
      /unknown key "generate\.siblings\.maxx"/.test(e.message) &&
      /known keys/.test(e.message),
  );
}));

test('an unknown top-level key is caught too', withTempDir((dir) => {
  assert.throws(() => readConfigFile(writeConfig(dir, { version: 2, apply: { out: 'x' } })), ConfigError);
}));

test('wrong types and out-of-range numbers are refused', withTempDir((dir) => {
  assert.throws(() => readConfigFile(writeConfig(dir, { generate: { exact: 'yes' } })), ConfigError);
  assert.throws(() => readConfigFile(writeConfig(dir, { generate: { siblings: { max: -1 } } })), ConfigError);
  assert.throws(() => readConfigFile(writeConfig(dir, { generate: { siblings: { max: 1.5 } } })), ConfigError);
  assert.throws(() => readConfigFile(writeConfig(dir, { generate: { out: '' } })), ConfigError);
  assert.throws(() => readConfigFile(writeConfig(dir, { generate: 5 })), ConfigError);
}));

test('broken JSON and a bad version value are refused', withTempDir((dir) => {
  assert.throws(() => readConfigFile(writeConfig(dir, '{ nope')), /invalid JSON/);
  assert.throws(() => readConfigFile(writeConfig(dir, { version: 'two' })), /"version" must be/);
}));

test('$schema is ignored, "all" and booleans pass through', withTempDir((dir) => {
  const file = writeConfig(dir, {
    $schema: './hatch.config.schema.json',
    version: 1,
    generate: { parents: { max: 'all', required: true } },
  });
  assert.deepEqual(readConfigFile(file), { maxParents: 'all', parentsRequired: true });
}));

test('a version other than the current one is refused', withTempDir((dir) => {
  const file = writeConfig(dir, { version: CONFIG_VERSION + 1, generate: {} });
  assert.throws(() => readConfigFile(file), /"version" must be 1/);
}));

// ── file lookup ──────────────────────────────────────────────────────────────────

test('the config is searched for UPWARDS from the input file', withTempDir((dir) => {
  const file = writeConfig(dir, { version: 1, generate: { siblings: { max: 1 } } });
  const deep = join(dir, 'src', 'net');
  mkdirSync(deep, { recursive: true });
  assert.equal(findConfigFile(deep), file);

  const config = loadConfig({ startDir: deep, useFile: true });
  assert.equal(config.generate.maxSiblings, 1);
  assert.equal(config.file, file);
}));

test('--no-config ignores the file, --config demands an existing one', withTempDir((dir) => {
  writeConfig(dir, { version: 1, generate: { siblings: { max: 1 } } });
  const off = loadConfig({ startDir: dir, useFile: false });
  assert.equal(off.generate.maxSiblings, DEFAULT_SETTINGS.maxSiblings);
  assert.equal(off.file, undefined);

  assert.throws(
    () => loadConfig({ startDir: dir, useFile: true, explicitPath: join(dir, 'nope.json') }),
    (e: unknown) => e instanceof ConfigError && /no such config file/.test(e.message),
  );
}));

test('formatConfig prints every value with its origin', () => {
  const text = formatConfig(resolveConfig({ flags: [{ key: 'maxSiblings', value: 0, flag: '--siblings' }] }));
  assert.match(text, /^version = 1$/m);
  assert.match(text, /generate\.siblings\.max\s+= 0\s+\[flag --siblings\]/);
  assert.match(text, /generate\.parents\.min\s+= 1\s+\[default\]/);
});

test('the JSON Schema lists exactly the keys the code knows', () => {
  const schemaPath = fileURLToPath(new URL('../../hatch.config.schema.json', import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, never>;
  const paths: string[] = [];
  const walk = (node: Record<string, never>, prefix: string): void => {
    for (const [key, value] of Object.entries(node['properties'] ?? {})) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      const child = value as Record<string, never>;
      if (child['properties'] !== undefined) walk(child, path);
      else if (path !== '$schema' && path !== 'version') paths.push(path);
    }
  };
  walk(schema, '');
  assert.deepEqual(paths.sort(), knownConfigKeys().sort());
});

// ── limits drive the synthesis ───────────────────────────────────────────────────

const NESTED_OLD = 'namespace net {\nvoid f() {\n  int a = 1;\n  g(a);\n}\n}\n';
const NESTED_NEW = 'namespace net {\nvoid f() {\n  int a = 2;\n  g(a);\n}\n}\n';

test('parents.min: the ladder starts at the requested number of parents', async () => {
  await cppAdapter.init();
  const one = printHatchFile(synthesize(NESTED_OLD, NESTED_NEW, cppAdapter), 'cpp');
  assert.ok(!one.includes('namespace net {'), one);

  const two = printHatchFile(synthesize(NESTED_OLD, NESTED_NEW, cppAdapter, { limits: { minParents: 2 } }), 'cpp');
  assert.ok(two.includes('namespace net {'), two);
  assert.ok(two.includes('void f() {'), two);
});

test('parents.max caps the climb, and asking for more than the file has is fine', async () => {
  await cppAdapter.init();
  const capped = printHatchFile(
    synthesize(NESTED_OLD, NESTED_NEW, cppAdapter, { limits: { minParents: 5, maxParents: 1 } }),
    'cpp',
  );
  assert.ok(!capped.includes('namespace net {'), capped);
});

test('siblings.max = 0: ambiguity is resolved by structure, not by a neighbour', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  x = 1;\n  y();\n  x = 1;\n}\n';
  const newStr = 'void f() {\n  x = 2;\n  y();\n  x = 1;\n}\n';
  const withNeighbours = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  assert.ok(withNeighbours.includes('y();'), withNeighbours);

  const structural = printHatchFile(synthesize(oldStr, newStr, cppAdapter, { limits: { maxSiblings: 0 } }), 'cpp');
  assert.ok(!structural.includes('y();'), structural);
  assert.ok(structural.includes('void f() {'), structural);
});

test('siblings.max = 0: an edit only a neighbour could pin is refused, not guessed', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  a();\n  b();\n}\n';
  const newStr = 'void f() {\n  a();\n  x();\n  b();\n}\n';
  assert.ok(printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp').includes('a();'));
  assert.throws(() => synthesize(oldStr, newStr, cppAdapter, { limits: { maxSiblings: 0 } }), MatchError);
});

test('detail.base: the baseline decides how much of a bracket stays spelled out', async () => {
  await cppAdapter.init();
  const oldStr = 'void f(map<int, A> m) {\n  x = 1;\n}\n';
  const newStr = 'void f(map<int, A> m) {\n  x = 2;\n}\n';

  const collapsed = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  assert.ok(!collapsed.includes('map<'), collapsed);

  const readable = printHatchFile(synthesize(oldStr, newStr, cppAdapter, { limits: { parentDetailBase: 1 } }), 'cpp');
  assert.ok(readable.includes('void f(map<'), readable);
  assert.ok(!readable.includes('<int, A>'), readable);

  const verbose = printHatchFile(synthesize(oldStr, newStr, cppAdapter, { limits: { parentDetailBase: 2 } }), 'cpp');
  assert.ok(verbose.includes('void f(map<int, A> m) {'), verbose);
});

test('the round unfolds a neighbour bracket by itself when that is what tells them apart', async () => {
  await cppAdapter.init();
  const oldStr = 'void f() {\n  log(fmt(a, b));\n  x = 1;\n  log(fmt(c, d));\n  x = 1;\n}\n';
  const newStr = 'void f() {\n  log(fmt(a, b));\n  x = 1;\n  log(fmt(c, d));\n  x = 2;\n}\n';
  const md = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  // No ceiling was needed and no ceiling was set: the neighbour is the discriminator,
  // so the round spelled that ONE bracket out and stopped.
  assert.ok(md.includes('log(fmt(c, d));'), md);
});

test('a bracket that discriminates nothing is NOT dragged along', async () => {
  await cppAdapter.init();
  // Two classes of the same name; only the base differs, and it differs INSIDE <>.
  // The old global detail number lifted every bracket at that level, so `void Run(...)`
  // came out as `void Run(map< ... > m)` — text that pins nothing and breaks on the next
  // signature change. The round names one bracket instead.
  const oldStr =
    'class W : public Base<Alpha> {\n  void Run(map<int, T> m) {\n    x = 1;\n  }\n};\n' +
    'class W : public Base<Beta> {\n  void Run(map<int, T> m) {\n    x = 1;\n  }\n};\n';
  const newStr = oldStr.replace('Base<Beta> {\n  void Run(map<int, T> m) {\n    x = 1;', 'Base<Beta> {\n  void Run(map<int, T> m) {\n    x = 2;');
  const md = printHatchFile(synthesize(oldStr, newStr, cppAdapter), 'cpp');
  assert.ok(md.includes('Base<Beta>'), md); // the bracket that DID discriminate
  assert.ok(!md.includes('map<'), md); // the one that did not
});

// ── CLI ──────────────────────────────────────────────────────────────────────────

// Через ЕДИНЫЙ вход, а не напрямую в generate.ts: так тесты заодно держат диспетчер.
const HATCH_CLI = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', HATCH_CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function seedSources(dir: string): void {
  writeFileSync(join(dir, 'old.cc'), NESTED_OLD);
  writeFileSync(join(dir, 'in.cc'), NESTED_NEW);
}

test('CLI: out and language come from the config, --print-config shows the origin', withTempDir((dir) => {
  seedSources(dir);
  mkdirSync(join(dir, 'patches'));
  writeConfig(dir, { version: 1, generate: { out: 'patches/', language: 'cpp', parents: { min: 2 } } });

  const printed = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--print-config'], dir);
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /generate\.out\s+= "patches\/"\s+\[config .*hatch\.config\.json\]/);

  const gen = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc'], dir);
  assert.equal(gen.status, 0, gen.stderr);
  const md = readFileSync(join(dir, 'patches', 'in.cc.md'), 'utf8');
  assert.match(md, /^# match cpp$/m);
  assert.ok(md.includes('namespace net {'), md);
}));

test('CLI: a flag beats the config, --no-config drops the file', withTempDir((dir) => {
  seedSources(dir);
  writeConfig(dir, { version: 1, generate: { language: 'cpp', parents: { min: 2 } } });

  const flagWins = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--min-parents', '1', '--out', '-'], dir);
  assert.equal(flagWins.status, 0, flagWins.stderr);
  assert.ok(!flagWins.stdout.includes('namespace net {'), flagWins.stdout);

  const printed = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--no-config', '--print-config'], dir);
  assert.match(printed.stdout, /generate\.parents\.min\s+= 1\s+\[default\]/);
  assert.match(printed.stdout, /generate\.language\s+= null\s+\[default\]/);
}));

test('CLI: a broken config and a broken flag value both exit with 5', withTempDir((dir) => {
  seedSources(dir);
  writeConfig(dir, { version: 1, generate: { siblings: { max: -1 } } });
  const broken = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--out', '-'], dir);
  assert.equal(broken.status, 5, broken.stderr);
  assert.match(broken.stderr, /ConfigError/);

  const badFlag = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--no-config', '--siblings', 'x'], dir);
  assert.equal(badFlag.status, 5, badFlag.stderr);
}));

test('CLI: --parent-detail is honoured, and the removed ceiling flag is refused', withTempDir((dir) => {
  seedSources(dir);
  writeConfig(dir, { generate: { language: 'cpp', parents: { detail: { base: 0 } } } });
  const gen = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--parent-detail', '1', '--out', '-'], dir);
  assert.equal(gen.status, 0, gen.stderr);
  assert.match(gen.stdout, /^# match cpp$/m);

  const stale = runCli(['generate', '--in', 'in.cc', '--in-old', 'old.cc', '--parent-detail-limit', '1', '--out', '-'], dir);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /--parent-detail-limit/);
}));
