import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const CLI = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--experimental-strip-types', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('bare invocation prints the usage and succeeds', () => {
  const r = run([]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /hatch <command>/);
  for (const name of ['apply', 'generate', 'grammars']) assert.match(r.stdout, new RegExp(`\\b${name}\\b`));
});

test('--version reports the package version AND the config schema version', () => {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { version: string; name: string };
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(pkg.version.replace(/\./g, '\\.')));
  assert.match(r.stdout, /config schema v\d+/);
});

test('an unknown command names the known ones and exits 1', () => {
  const r = run(['aply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command 'aply'/);
  assert.match(r.stderr, /known commands: apply, generate, grammars/);
});

test('a flag in the command slot gets its own sentence, not the list', () => {
  // `hatch --in x` is the slip people actually make; "known commands: …" answers a
  // question they did not ask.
  const r = run(['--in', 'x.cc']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /options come AFTER the command/);
});

test('a command forwards its own --help, not the dispatcher\'s', () => {
  const r = run(['generate', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /hatch generate —/);
  assert.match(r.stdout, /--in-old/);
});

test('a command keeps its own exit code through the dispatcher', () => {
  // 1 = usage error from generate itself (no --in), not the dispatcher's.
  const r = run(['generate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --in/);
});

test('the dispatcher lists exactly the commands it can load', async () => {
  // The USAGE text is generated from the same table that dispatch uses, so this cannot
  // drift; the test pins that they are one table and not two.
  const usage = run([]).stdout;
  const listed = [...usage.matchAll(/^ {2}(\w+) {2,}/gm)].map((m) => m[1] ?? '');
  for (const name of listed) {
    if (name === '' || name === 'hatch') continue;
    const r = run([name, '--help']);
    assert.equal(r.status, 0, `${name} --help failed: ${r.stderr}`);
  }
});
