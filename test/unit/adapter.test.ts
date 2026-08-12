import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adapterForLanguage,
  adapterForFile,
  supportedLanguages,
} from '../../src/lang/adapter.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { cAdapter } from '../../src/lang/c/index.ts';
import { objcAdapter } from '../../src/lang/objc/index.ts';
import { pythonAdapter } from '../../src/lang/python/index.ts';
import { javascriptAdapter } from '../../src/lang/javascript/index.ts';
import { typescriptAdapter } from '../../src/lang/typescript/index.ts';
import { tsxAdapter } from '../../src/lang/tsx/index.ts';
import { rustAdapter } from '../../src/lang/rust/index.ts';
import { javaAdapter } from '../../src/lang/java/index.ts';
import { kotlinAdapter } from '../../src/lang/kotlin/index.ts';
import { goAdapter } from '../../src/lang/go/index.ts';

test('language name resolves to its adapter (case-insensitive, aliases)', () => {
  assert.equal(adapterForLanguage('cpp'), cppAdapter);
  assert.equal(adapterForLanguage('C++'), cppAdapter);
  assert.equal(adapterForLanguage('  CC  '), cppAdapter);
});

test('every language of the Chromium set resolves to its own adapter', () => {
  assert.equal(adapterForLanguage('c'), cAdapter); // C is NOT C++: its own grammar
  assert.equal(adapterForLanguage('objective-c'), objcAdapter);
  assert.equal(adapterForLanguage('python'), pythonAdapter);
  assert.equal(adapterForLanguage('py'), pythonAdapter);
  assert.equal(adapterForLanguage('JS'), javascriptAdapter);
  assert.equal(adapterForLanguage('jsx'), javascriptAdapter); // JSX is part of the js grammar
  assert.equal(adapterForLanguage('ts'), typescriptAdapter);
  assert.equal(adapterForLanguage('tsx'), tsxAdapter); // a SEPARATE grammar, not an alias of ts
  assert.equal(adapterForLanguage('rust'), rustAdapter);
  assert.equal(adapterForLanguage('java'), javaAdapter);
  assert.equal(adapterForLanguage('kt'), kotlinAdapter);
  assert.equal(adapterForLanguage('golang'), goAdapter);
});

test('missing language → clear error, not a silent default', () => {
  assert.throws(() => adapterForLanguage(undefined), /not specified/);
  assert.throws(() => adapterForLanguage(''), /not specified/);
});

test('unknown language → unsupported error (closed whitelist, no dynamic import)', () => {
  assert.throws(() => adapterForLanguage('cobol'), /unsupported language 'cobol'/);
  // a path in place of the name must not turn into a module load
  assert.throws(() => adapterForLanguage('../../etc/passwd'), /unsupported language/);
  assert.ok(supportedLanguages.includes('cpp'));
});

test('file extension resolves to its adapter', () => {
  assert.equal(adapterForFile('src/foo.cc'), cppAdapter);
  assert.equal(adapterForFile('C:/x/Bar.HPP'), cppAdapter);
});

test('extensions of the Chromium set do not overlap and hit the right adapter', () => {
  assert.equal(adapterForFile('base/foo.c'), cAdapter);
  assert.equal(adapterForFile('base/foo.h'), cppAdapter); // Chromium convention: .h is C++
  assert.equal(adapterForFile('ui/cocoa/foo.mm'), objcAdapter);
  assert.equal(adapterForFile('build/gen.py'), pythonAdapter);
  assert.equal(adapterForFile('devtools/x.js'), javascriptAdapter);
  assert.equal(adapterForFile('devtools/x.ts'), typescriptAdapter);
  assert.equal(adapterForFile('devtools/X.TSX'), tsxAdapter);
  assert.equal(adapterForFile('components/lib.rs'), rustAdapter);
  assert.equal(adapterForFile('android/Foo.java'), javaAdapter);
  assert.equal(adapterForFile('android/Foo.kt'), kotlinAdapter);
  assert.equal(adapterForFile('infra/main.go'), goAdapter);
});

test('unknown extension → error', () => {
  assert.throws(() => adapterForFile('notes.txt'), /no adapter for file extension/);
});
