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

test('resolve: вставка — диапазон в базе пустой, в применённом тексте несёт вставленное', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const { links, applied } = await resolve(md);

  const link = links[0]!;
  assert.equal(link.status, 'ok');
  assert.equal(link.base!.start, link.base!.end, 'вставка ничего не заменяет');
  assert.equal(BASE.slice(0, link.base!.start).endsWith('one();'), true);
  assert.equal(link.finalText, 'two();');
  assert.equal(applied.slice(link.final!.start, link.final!.end), 'two();');
  assert.equal(link.dependsOnEarlier, false);
});

test('resolve: замена — диапазон в базе накрывает ровно заменяемый текст', async () => {
  const md = hatchMd([{ match: '... >>> one(); <<< ...', patch: 'two();' }]);
  const { links } = await resolve(md);

  const link = links[0]!;
  assert.equal(link.status, 'ok');
  assert.equal(BASE.slice(link.base!.start, link.base!.end), 'one();');
  assert.equal(link.finalText, 'two();');
});

test('resolve: mdSpan ханка указывает на его строки в .md', async () => {
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
  assert.ok(links[0]!.mdSpan![1] < links[1]!.mdSpan![0], 'спаны не пересекаются');
});

test('resolve: второй ханк, опирающийся на вставку первого, помечен dependsOnEarlier', async () => {
  const md = hatchMd([
    { match: '... one(); >>> ...', patch: 'two();' },
    { match: '... two(); >>> ...', patch: 'three();' },
  ]);
  const { links, applied } = await resolve(md);

  assert.equal(links[0]!.dependsOnEarlier, false);
  assert.equal(links[1]!.status, 'ok', 'по проигранному тексту он находится');
  assert.equal(links[1]!.dependsOnEarlier, true, 'в чистой базе его якоря нет');
  assert.equal(links[1]!.finalText, 'three();');
  assert.ok(applied.indexOf('two();') < applied.indexOf('three();'), applied);
});

test('resolve: сдвиг от предыдущего ханка учтён — final сдвинут, base остался базовым', async () => {
  const md = hatchMd([
    { match: '... namespace f { >>> ...', patch: '\nint counter;' },
    { match: '... >>> one(); <<< ...', patch: 'two();' },
  ]);
  const { links, applied } = await resolve(md);

  const second = links[1]!;
  assert.equal(BASE.slice(second.base!.start, second.base!.end), 'one();', 'в координатах базы');
  assert.equal(applied.slice(second.final!.start, second.final!.end), 'two();', 'в координатах итога');
  assert.equal(
    second.final!.start - second.base!.start,
    '\nint counter;'.length,
    'ровно на длину того, что внёс первый ханк',
  );
});

test('resolve: отказ одного ханка не отменяет остальные', async () => {
  const md = hatchMd([
    { match: '... one(); >>> ...', patch: 'two();' },
    { match: '... nosuchcall(); >>> ...', patch: 'three();' },
  ]);
  const { links, applied } = await resolve(md);

  assert.equal(links[0]!.status, 'ok');
  assert.equal(links[1]!.status, 'no-match');
  assert.equal(links[1]!.failure!.kind, 'MatchError');
  assert.equal(links[1]!.base, undefined, 'у несошедшегося ханка координат нет');
  assert.ok(applied.includes('two();'), 'первый ханк всё равно применён');
  assert.ok(!applied.includes('three();'));
});

test('resolve: mdLine отказа указывает на строку якоря, который не сошёлся', async () => {
  const md = hatchMd([{ match: ['...', 'one();', '...', 'nosuchcall();', '>>>', '...'].join('\n'), patch: 'X();' }]);
  const { links } = await resolve(md);

  const failure = links[0]!.failure!;
  assert.equal(failure.failedStepIndex, 1, 'первый якорь сошёлся, второй нет');
  const line = md.split('\n')[failure.mdLine! - 1]!;
  assert.equal(line.trim(), 'nosuchcall();');
});

test('resolve: неоднозначный шаблон — статус ambiguous и места-кандидаты', async () => {
  const baseline = ['void a() { one(); }', 'void b() { one(); }', ''].join('\n');
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'X();' }]);
  const { links } = await resolve(md, baseline);

  const link = links[0]!;
  assert.equal(link.status, 'ambiguous');
  assert.equal(link.failure!.kind, 'AmbiguityError');
  assert.ok(link.failure!.candidates!.length >= 2, 'кандидатов не меньше двух');
  for (const pos of link.failure!.candidates!) {
    assert.ok(pos >= 0 && pos <= baseline.length, `кандидат ${pos} вне текста базы`);
  }
});
