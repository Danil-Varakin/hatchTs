import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { applyAll } from '../../src/core/apply.ts';
import { adapterForLanguage } from '../../src/lang/adapter.ts';
import type { LanguageAdapter } from '../../src/lang/source-map.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const mustRefuse = (text: string): boolean => (text.split('\n', 1)[0] ?? '').includes('MUST-REFUSE');

const knownGap = (text: string): boolean => text.slice(0, 400).includes('KNOWN-GAP');

function describe(text: string): string {
  const m = /^(?:\/\/|#)\s*(\[.*)$/.exec(text.split('\n', 1)[0] ?? '');
  return m === null ? '' : ` ${m[1]!.trim()}`;
}

const adapters = new Map<string, LanguageAdapter>();
async function adapterFor(language: string): Promise<LanguageAdapter> {
  let a = adapters.get(language);
  if (a === undefined) {
    a = adapterForLanguage(language);
    await a.init();
    adapters.set(language, a);
  }
  return a;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const languages = readdirSync(HERE)
  .filter((name) => isDir(join(HERE, name)))
  .sort();

for (const language of languages) {
  const generateDir = join(HERE, language, 'generate');
  const applyDir = join(HERE, language, 'apply');

  if (isDir(generateDir)) {
    const files = readdirSync(generateDir);
    const numbers = [...new Set(files.map((f) => /^test(\d+)\.old\./.exec(f)?.[1]).filter(Boolean))]
      .map(Number)
      .sort((a, b) => a - b);

    for (const n of numbers) {
      const oldFile = files.find((f) => f.startsWith(`test${n}.old.`))!;
      const newFile = files.find((f) => f.startsWith(`test${n}.new.`))!;
      const oldStr = readFileSync(join(generateDir, oldFile), 'utf8');
      const newStr = readFileSync(join(generateDir, newFile), 'utf8');
      const goldenPath = join(generateDir, `test${n}.md`);

      test(`golden ${language}/generate/${n}${describe(oldStr)}`, async () => {
        const adapter = await adapterFor(language);

        if (knownGap(oldStr)) {
          assert.throws(
            () => synthesize(oldStr, newStr, adapter),
            'this case synthesizes now — remove the KNOWN-GAP marker and commit the golden .md',
          );
          return;
        }

        const md = printHatchFile(
          synthesize(oldStr, newStr, adapter),
          oldFile.slice(oldFile.lastIndexOf('.') + 1),
        );

        const applied = applyAll(oldStr, parseHatchFile(md), adapter).source;
        assert.equal(applied, newStr, 'applying the generated .md did not reproduce the new file');

        if (UPDATE) {
          writeFileSync(goldenPath, md);
          return;
        }
        assert.ok(
          existsSync(goldenPath),
          `no golden for ${language}/generate/${n}: run \`UPDATE_GOLDEN=1 npm test\`, ` +
            'read the produced .md, and commit it only if it is what you meant',
        );
        assert.equal(
          md,
          readFileSync(goldenPath, 'utf8'),
          `the printed form changed. If that is intended: UPDATE_GOLDEN=1 npm test, then read the diff`,
        );
      });
    }
  }

  if (isDir(applyDir)) {
    const files = readdirSync(applyDir);
    const numbers = files
      .map((f) => /^test(\d+)\.md$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);

    for (const n of numbers) {
      const sourceFile = files.find(
        (f) => f.startsWith(`test${n}.`) && !f.endsWith('.md') && !f.startsWith(`test${n}.expected.`),
      );
      if (sourceFile === undefined) continue;
      const source = readFileSync(join(applyDir, sourceFile), 'utf8');
      const md = readFileSync(join(applyDir, `test${n}.md`), 'utf8');

      const expectedPath = join(applyDir, `test${n}.expected${extname(sourceFile)}`);

      test(`golden ${language}/apply/${n}${describe(source)}`, async () => {
        const adapter = await adapterFor(language);
        const run = (): string => applyAll(source, parseHatchFile(md), adapter).source;

        if (mustRefuse(source)) {
          assert.throws(run, 'these instructions applied, and they must not');
          return;
        }
        const result = run();
        assert.notEqual(result, source, 'the patch applied but changed nothing');

        if (UPDATE) {
          writeFileSync(expectedPath, result);
          return;
        }
        assert.ok(
          existsSync(expectedPath),
          `no expected result for ${language}/apply/${n}: run \`UPDATE_GOLDEN=1 npm test\`, ` +
            'read the produced file, and commit it only if it is what you meant',
        );
        assert.equal(
          result,
          readFileSync(expectedPath, 'utf8'),
          'applying these instructions no longer produces the recorded result',
        );
      });
    }
  }
}
