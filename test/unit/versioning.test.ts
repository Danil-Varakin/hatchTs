import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PROTOCOL_MIN, PROTOCOL_VERSION } from '../../src/service/protocol.ts';
import { CONFIG_MIN, CONFIG_VERSION } from '../../src/infra/config/schema.ts';
import { handle } from '../../src/service/handler.ts';

// The parts of VERSIONING.md a machine can hold. A failure here is not a flaky test: it
// means a number moved without the rule that governs it — read VERSIONING.md first.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name: string): string => readFileSync(join(ROOT, name), 'utf8');
const json = (name: string): Record<string, unknown> => JSON.parse(read(name)) as Record<string, unknown>;

const PACKAGE = json('package.json')['version'] as string;

test('R1/C1: both ranges are ranges of positive whole numbers, minimum first', () => {
  for (const [name, min, max] of [
    ['protocol', PROTOCOL_MIN, PROTOCOL_VERSION],
    ['config schema', CONFIG_MIN, CONFIG_VERSION],
  ] as const) {
    assert.ok(Number.isInteger(min) && min >= 1, `${name}: minimum ${min}`);
    assert.ok(Number.isInteger(max) && max >= min, `${name}: ${min}–${max}`);
  }
});

test('R1: the service announces the range it serves, not a single number', async () => {
  const response = await handle({ id: 1, method: 'version' });
  assert.ok(response.ok);
  const result = response.result as Record<string, unknown>;
  assert.equal(result['protocol'], PROTOCOL_VERSION);
  assert.equal(result['protocolMin'], PROTOCOL_MIN);
  assert.equal(result['configSchema'], CONFIG_VERSION);
  assert.equal(result['configSchemaMin'], CONFIG_MIN);
});

test('C1: hatch.config.schema.json states the range the code reads', () => {
  const schema = json('hatch.config.schema.json') as { properties: { version: Record<string, unknown> } };
  const version = schema.properties.version;
  assert.equal(version['minimum'], CONFIG_MIN, 'minimum = CONFIG_MIN');
  assert.equal(version['maximum'], CONFIG_VERSION, 'maximum = CONFIG_VERSION');
  assert.equal(version['const'], undefined, 'a range, never a single value');
});

test('P5: package-lock.json carries the same version as package.json', () => {
  const lock = json('package-lock.json') as { version: string; packages: Record<string, { version: string }> };
  assert.equal(lock.version, PACKAGE);
  assert.equal(lock.packages['']!.version, PACKAGE);
});

test('P6: CHANGELOG.md has the entry of the version package.json names', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${PACKAGE.replace(/\./g, '\\.')} — \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});

test('P6: the newest CHANGELOG entry states the ranges the code has now', () => {
  const changelog = read('CHANGELOG.md');
  const newest = changelog.slice(changelog.indexOf('\n## '));
  const line = /\*\*Protocol (\d+)–(\d+) · config schema (\d+)–(\d+)\*\*/.exec(newest);
  assert.ok(line !== null, 'the newest entry opens with its ranges');
  assert.deepEqual(
    line.slice(1).map(Number),
    [PROTOCOL_MIN, PROTOCOL_VERSION, CONFIG_MIN, CONFIG_VERSION],
    'protocol M–N and config M–N in the newest entry match src/',
  );
});

test('R10: every protocol a client may still speak has its section in PROTOCOL.md', () => {
  const protocol = read('PROTOCOL.md');
  for (let n = PROTOCOL_MIN; n <= PROTOCOL_VERSION; n++) {
    assert.match(protocol, new RegExp(`^### Protocol ${n}$`, 'm'), `PROTOCOL.md has "### Protocol ${n}"`);
  }
});

test('R10: every number the code speaks has its row in VERSIONING.md', () => {
  const versioning = read('VERSIONING.md');
  const section = (title: string): string => {
    const from = versioning.indexOf(`### ${title}`);
    assert.ok(from !== -1, `VERSIONING.md has "### ${title}"`);
    const to = versioning.indexOf('\n### ', from + 1);
    return versioning.slice(from, to === -1 ? undefined : to);
  };
  assert.match(section('Protocol'), new RegExp(`^\\| ${PROTOCOL_VERSION} \\|`, 'm'), `protocol ${PROTOCOL_VERSION}`);
  assert.match(section('Config schema'), new RegExp(`^\\| ${CONFIG_VERSION} \\|`, 'm'), `config schema ${CONFIG_VERSION}`);
  assert.match(
    section('Releases'),
    new RegExp(`^\\| ${PACKAGE.replace(/\./g, '\\.')} \\|`, 'm'),
    `a row for the released ${PACKAGE}`,
  );
});
