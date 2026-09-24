import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/objc/index.ts';

test("a digit separator is not a char literal: 1'000 does not open a zone", () => {
  assert.equal(normalize("int n = 1'000; int m = 2  +  3;"), "int n=1'000;int m=2+3;");
  assert.equal(normalize("NSUInteger x = 0xAB'CD;  g();"), "NSUInteger x=0xAB'CD;g();");
  assert.equal(normalize("int a = 1'000'000; int b = 2  +  3;"), "int a=1'000'000;int b=2+3;");
});

test('a real char literal still opens a zone', () => {
  assert.equal(normalize("char c = 'a';  int m = 2  +  3;"), "char c='a';int m=2+3;");
  assert.equal(normalize("' '"), "' '");
});

test('an @"..." literal is a string zone: its spaces are data', () => {
  assert.equal(normalize('NSLog(@"a  b");'), 'NSLog(@"a  b");');
  assert.equal(normalize('  id s = @"a  b";'), 'id s=@"a  b";');
});
