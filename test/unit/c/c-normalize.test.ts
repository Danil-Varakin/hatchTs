import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../../../src/lang/c/index.ts';

test("a digit separator is not a char literal: 1'000 does not open a zone", () => {
  assert.equal(normalize("int n = 1'000; int m = 2  +  3;"), "int n=1'000;int m=2+3;");
  assert.equal(normalize("unsigned x = 0xAB'CD;  g();"), "unsigned x=0xAB'CD;g();");
  assert.equal(normalize("int a = 1'000'000; int b = 2  +  3;"), "int a=1'000'000;int b=2+3;");
});

test('a real char literal still opens a zone', () => {
  assert.equal(normalize("char c = 'a';  int m = 2  +  3;"), "char c='a';int m=2+3;");
  assert.equal(normalize("switch (c) { case 'x':  g();  break; }"), "switch(c){case'x':g();break;}");
  assert.equal(normalize("' '"), "' '");
});

test('whitespace inside a string literal is DATA and survives canon', () => {
  assert.equal(normalize('printf("a  b");'), 'printf("a  b");');
  assert.equal(normalize('  int x = "a  b";'), 'int x="a  b";');
});
