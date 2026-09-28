import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { answersFrom } from '../../src/cli/prompt.ts';

function streams(): { input: PassThrough; output: PassThrough; written: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => (text += String(chunk)));
  return { input, output, written: () => text };
}

test('answersFrom: several answers piped at once reach several questions, in order', async () => {
  const { input, output } = streams();
  input.end('y\nn\n\n');
  const answers = answersFrom(input, output);
  assert.equal(await answers.next('1? '), 'y');
  assert.equal(await answers.next('2? '), 'n');
  assert.equal(await answers.next('3? '), '', 'an empty line is an answer: Enter');
  assert.equal(await answers.next('4? '), null, 'past the last line: the input closed');
  answers.close();
});

test('answersFrom: an answer that comes later is waited for, and every prompt is written', async () => {
  const { input, output, written } = streams();
  const answers = answersFrom(input, output);
  const first = answers.next('keep? ');
  setTimeout(() => input.write('yes\n'), 5);
  assert.equal(await first, 'yes');
  const second = answers.next('again? ');
  setTimeout(() => input.end(), 5);
  assert.equal(await second, null, 'a close while waiting settles the wait');
  assert.equal(written(), 'keep? again? ');
  answers.close();
});

test('answersFrom: a reader never asked anything opens nothing and closes quietly', () => {
  const { input, output } = streams();
  answersFrom(input, output).close();
  assert.equal(input.listenerCount('data'), 0);
});
