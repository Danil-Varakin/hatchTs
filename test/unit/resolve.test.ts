import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { resolveHunks } from '../../src/core/resolve.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';
import { hatchMd } from '../helpers.ts';

const BASE = ['namespace f {', 'void a() {', '  one();', '}', '}', ''].join('\n');

async function resolve(md: string, baseline = BASE) {
  await cppAdapter.init();
  return resolveHunks(baseline, parseHatchFile(md), cppAdapter);
}

test('resolve: an insertion is empty in the baseline and carries the text in the result', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const { links, applied } = await resolve(md);

  const link = links[0]!;
  assert.equal(link.status, 'ok');
  assert.equal(link.base!.start, link.base!.end, 'an insertion replaces nothing');
  assert.equal(BASE.slice(0, link.base!.start).endsWith('one();'), true);
  assert.equal(link.finalText, 'two();');
  assert.equal(applied.slice(link.final!.start, link.final!.end), 'two();');
  assert.equal(link.dependsOnEarlier, false);
});

test('resolve: a replacement spans exactly the text it replaces in the baseline', async () => {
  const md = hatchMd([{ match: '... >>> one(); <<< ...', patch: 'two();' }]);
  const { links } = await resolve(md);

  const link = links[0]!;
  assert.equal(link.status, 'ok');
  assert.equal(BASE.slice(link.base!.start, link.base!.end), 'one();');
  assert.equal(link.finalText, 'two();');
});

test('resolve: the mdSpan of a hunk points at its own lines in the .md', async () => {
  const md = hatchMd([
    { match: '... one(); >>> ...', patch: 'two();' },
    { match: '... two(); >>> ...', patch: 'three();' },
  ]);
  const { links } = await resolve(md);
  const lines = md.split('\n');

  for (const link of links) {
    const [from, to] = link.mdSpan!;
    assert.equal(lines[from - 1], '# match cpp');
    assert.equal(lines[to - 1], '# end');
  }
  assert.ok(links[0]!.mdSpan![1] < links[1]!.mdSpan![0], 'the spans do not overlap');
});

test('resolve: a hunk leaning on an earlier insertion is marked dependsOnEarlier', async () => {
  const md = hatchMd([
    { match: '... one(); >>> ...', patch: 'two();' },
    { match: '... two(); >>> ...', patch: 'three();' },
  ]);
  const { links, applied } = await resolve(md);

  assert.equal(links[0]!.dependsOnEarlier, false);
  assert.equal(links[1]!.status, 'ok', 'it resolves against the replayed text');
  assert.equal(links[1]!.dependsOnEarlier, true, 'its anchor is absent from the pristine baseline');
  assert.equal(links[1]!.finalText, 'three();');
  assert.ok(applied.indexOf('two();') < applied.indexOf('three();'), applied);
});

test('resolve: an earlier hunk shifts final, while base stays in baseline coordinates', async () => {
  const md = hatchMd([
    { match: '... namespace f { >>> ...', patch: '\nint counter;' },
    { match: '... >>> one(); <<< ...', patch: 'two();' },
  ]);
  const { links, applied } = await resolve(md);

  const second = links[1]!;
  assert.equal(BASE.slice(second.base!.start, second.base!.end), 'one();', 'in baseline coordinates');
  assert.equal(applied.slice(second.final!.start, second.final!.end), 'two();', 'in the coordinates of the result');
  assert.equal(
    second.final!.start - second.base!.start,
    '\nint counter;'.length,
    'by exactly what the first hunk wrote',
  );
});

test('resolve: one hunk failing does not cancel the others', async () => {
  const md = hatchMd([
    { match: '... one(); >>> ...', patch: 'two();' },
    { match: '... nosuchcall(); >>> ...', patch: 'three();' },
  ]);
  const { links, applied } = await resolve(md);

  assert.equal(links[0]!.status, 'ok');
  assert.equal(links[1]!.status, 'no-match');
  assert.equal(links[1]!.failure!.kind, 'MatchError');
  assert.equal(links[1]!.base, undefined, 'a hunk that did not fit has no coordinates');
  assert.ok(applied.includes('two();'), 'the first hunk is applied all the same');
  assert.ok(!applied.includes('three();'));
});

test('resolve: the mdLine of a failure points at the anchor that did not fit', async () => {
  const md = hatchMd([{ match: ['...', 'one();', '...', 'nosuchcall();', '>>>', '...'].join('\n'), patch: 'X();' }]);
  const { links } = await resolve(md);

  const failure = links[0]!.failure!;
  assert.equal(failure.failedStepIndex, 1, 'the first anchor fitted, the second did not');
  const line = md.split('\n')[failure.mdLine! - 1]!;
  assert.equal(line.trim(), 'nosuchcall();');
});

test('resolve: an ambiguous pattern reports the status and every candidate place', async () => {
  const baseline = ['void a() { one(); }', 'void b() { one(); }', ''].join('\n');
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'X();' }]);
  const { links } = await resolve(md, baseline);

  const link = links[0]!;
  assert.equal(link.status, 'ambiguous');
  assert.equal(link.failure!.kind, 'AmbiguityError');
  assert.ok(link.failure!.candidates!.length >= 2, 'there are at least two candidates');
  for (const pos of link.failure!.candidates!) {
    assert.ok(pos >= 0 && pos <= baseline.length, `candidate ${pos} falls outside the baseline`);
  }
});
