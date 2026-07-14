import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adapterForLanguage,
  adapterForFile,
  supportedLanguages,
} from '../../src/lang/adapter.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';

test('language name resolves to its adapter (case-insensitive, aliases)', () => {
  assert.equal(adapterForLanguage('cpp'), cppAdapter);
  assert.equal(adapterForLanguage('C++'), cppAdapter);
  assert.equal(adapterForLanguage('  CC  '), cppAdapter);
});

test('missing language → clear error, not a silent default', () => {
  assert.throws(() => adapterForLanguage(undefined), /not specified/);
  assert.throws(() => adapterForLanguage(''), /not specified/);
});

test('unknown language → unsupported error (closed whitelist, no dynamic import)', () => {
  assert.throws(() => adapterForLanguage('rust'), /unsupported language 'rust'/);
  assert.ok(supportedLanguages.includes('cpp'));
});

test('file extension resolves to its adapter', () => {
  assert.equal(adapterForFile('src/foo.cc'), cppAdapter);
  assert.equal(adapterForFile('C:/x/Bar.HPP'), cppAdapter);
});

test('unknown extension → error', () => {
  assert.throws(() => adapterForFile('notes.txt'), /no adapter for file extension/);
});
