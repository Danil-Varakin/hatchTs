import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, parseCountValue } from '../../src/cli/args.ts';
import type { ArgSpec } from '../../src/cli/args.ts';

interface Options {
  in?: string;
  log?: string;
  parents?: unknown;
  verbose: boolean;
  useConfig: boolean;
}

const SPEC: ArgSpec<Options> = {
  flags: { '--verbose': 'verbose', '-v': 'verbose' },
  negated: { '--no-config': 'useConfig' },
  values: { '--in': 'in', '-i': 'in' },
  counts: { '--parents': 'parents' },
  optional: { '--log': 'log' },
};

const fresh = (): Options => ({ verbose: false, useConfig: true });
const parse = (argv: string[]): Options => parseArgs(argv, SPEC, fresh());

test('a flag sets true, a negated flag sets false, and defaults stay put', () => {
  assert.deepEqual(parse([]), { verbose: false, useConfig: true });
  assert.equal(parse(['-v']).verbose, true);
  assert.equal(parse(['--verbose']).verbose, true);
  assert.equal(parse(['--no-config']).useConfig, false);
  assert.equal(parse(['--no-config']).verbose, false);
});

test('a value option takes the next argument, aliases included', () => {
  assert.equal(parse(['--in', 'a.cc']).in, 'a.cc');
  assert.equal(parse(['-i', 'a.cc']).in, 'a.cc');
  assert.equal(parse(['-i', '-v']).in, '-v', 'the value is taken as is, even if it looks like a flag');
});

test('a value option with nothing after it is an error that names the option', () => {
  assert.throws(() => parse(['--in']), /option --in needs a value/);
  assert.throws(() => parse(['--parents']), /option --parents needs a value/);
});

test('an unknown argument is an error that quotes it', () => {
  assert.throws(() => parse(['--nosuch']), /unknown argument: --nosuch/);
  assert.throws(() => parse(['--in', 'a.cc', '-q']), /unknown argument: -q/);
});

test('an optional-value option takes a value only when one is there', () => {
  assert.equal(parse(['--log']).log, '', 'nothing after it means the default place');
  assert.equal(parse(['--log', '-v']).log, '', 'a flag after it is NOT the value');
  assert.equal(parse(['--log', '-v']).verbose, true, 'and that flag is still parsed');
  assert.equal(parse(['--log', 'run.log']).log, 'run.log');
});

test('counts: a number becomes a number, "all" survives, junk is passed on for validation', () => {
  assert.equal(parseCountValue('3'), 3);
  assert.equal(parseCountValue('0'), 0);
  assert.equal(parseCountValue('all'), 'all');
  assert.equal(parseCountValue('-1'), '-1');
  assert.equal(parseCountValue('two'), 'two');
  assert.equal(parse(['--parents', '3']).parents, 3);
  assert.equal(parse(['--parents', 'all']).parents, 'all');
});

test('order does not matter and later wins', () => {
  assert.deepEqual(parse(['-v', '--in', 'a.cc', '--no-config']), {
    verbose: true,
    useConfig: false,
    in: 'a.cc',
  });
  assert.equal(parse(['--in', 'a.cc', '--in', 'b.cc']).in, 'b.cc');
});
