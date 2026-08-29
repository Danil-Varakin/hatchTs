import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { applyAll } from '../../src/core/apply.ts';
import { hatchMd } from '../helpers.ts';

// ── applyAll: the pure core, no files ─────────────────────────────────────────

test('applyAll: a single insertion hunk changes the text', async () => {
  await cppAdapter.init();
  const file = parseHatchFile(hatchMd([{ match: '... a(); >>> ...', patch: 'X();' }]));
  const { source, edits } = applyAll('void f(){ a(); b(); }', file, cppAdapter);
  assert.equal(edits.length, 1);
  assert.ok(source.includes('a();X(); b();'), source);
});

test('applyAll: the second hunk leans on what the first inserted, in order', async () => {
  await cppAdapter.init();
  const file = parseHatchFile(
    hatchMd([
      { match: '... namespace f { >>> ...', patch: 'int a;' },
      { match: '... int a; >>> ...', patch: 'int b;' },
    ]),
  );
  const { source, edits } = applyAll('namespace f {\n}\n', file, cppAdapter);
  assert.equal(edits.length, 2);
  assert.ok(source.includes('int a;') && source.includes('int b;'), source);
  assert.ok(source.indexOf('int a;') < source.indexOf('int b;'), source);
});

// ── CLI end-to-end ────────────────────────────────

const CLI = fileURLToPath(new URL('../../src/cli/apply.ts', import.meta.url));

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
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

test('CLI apply: success is exit 0 and a written file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    const out = join(dir, 'out.cc');
    writeFileSync(src, 'void f(){ a(); b(); }');
    writeFileSync(md, hatchMd([{ match: '... a(); >>> ...', patch: 'X();' }]));

    const r = runCli(['--match', md, '--in', src, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(out, 'utf8').includes('a();X();'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply --verify: a clean fit is exit 0 and nothing written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    writeFileSync(src, 'void f(){ a(); b(); }');
    writeFileSync(md, hatchMd([{ match: '... a(); >>> ...', patch: 'X();' }]));

    const r = runCli(['--match', md, '--in', src, '--verify']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /verify: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply: no match is exit 3 (MatchError)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-'));
  try {
    const src = join(dir, 'src.cc');
    const md = join(dir, 'p.md');
    writeFileSync(src, 'void f(){ a(); }');
    writeFileSync(md, hatchMd([{ match: '... nope(); >>> ...', patch: 'X();' }]));

    const r = runCli(['--match', md, '--in', src, '--out', join(dir, 'o.cc')]);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /MatchError/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply: --out as a directory keeps the name, and directories are created', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-apply-out-'));
  try {
    const src = join(dir, 'in.cc');
    const md = join(dir, 'p.md');
    writeFileSync(src, 'void f() {\n  a();\n}\n');
    writeFileSync(md, hatchMd([{ match: '... a(); >>> ...', patch: 'X();' }]));

    const intoDir = runCli([...['--match', md, '--in', src], '--out', `${dir}/built/`]);
    assert.equal(intoDir.status, 0, intoDir.stderr);
    assert.match(readFileSync(join(dir, 'built', 'in.cc'), 'utf8'), /X\(\);/);

    const named = join(dir, 'deep', 'result.cc');
    const intoFile = runCli([...['--match', md, '--in', src], '--out', named]);
    assert.equal(intoFile.status, 0, intoFile.stderr);
    assert.match(readFileSync(named, 'utf8'), /X\(\);/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
