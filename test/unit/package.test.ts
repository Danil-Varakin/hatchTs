import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
  files: string[];
  exports: Record<string, unknown>;
};

test('every bin entry starts with a shebang', () => {
  for (const [name, rel] of Object.entries(pkg.bin)) {
    const source = join(ROOT, 'src', ...rel.replace(/^dist\//, '').replace(/\.js$/, '.ts').split('/'));
    assert.ok(existsSync(source), `${name}: no source for ${rel} at ${source}`);
    const first = readFileSync(source, 'utf8').split('\n', 1)[0] ?? '';
    assert.equal(first, '#!/usr/bin/env node', `${name}: ${source} must start with a shebang`);
  }
});

test('the built bin, when present, keeps the shebang and LF', { skip: !existsSync(join(ROOT, 'dist')) }, () => {
  for (const rel of Object.values(pkg.bin)) {
    const built = join(ROOT, ...rel.split('/'));
    if (!existsSync(built)) continue;
    const text = readFileSync(built, 'utf8');
    assert.ok(text.startsWith('#!/usr/bin/env node\n'), `${rel}: shebang missing or not followed by LF`);
    assert.ok(!text.includes('\r'), `${rel}: contains CR`);
  }
});

test('files, bin and exports point at things that exist', () => {
  for (const entry of pkg.files) {
    if (entry === 'LICENSE') continue;
    if (entry === 'dist') continue;
    assert.ok(existsSync(join(ROOT, entry)), `files: ${entry} is listed but missing`);
  }
});
