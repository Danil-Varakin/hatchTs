import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { handle } from '../../src/service/handler.ts';
import { serve } from '../../src/service/index.ts';
import { PROTOCOL_VERSION } from '../../src/service/protocol.ts';
import type { ProgressMessage, ResponseMessage, ServiceError } from '../../src/service/protocol.ts';
import type { HunkLink } from '../../src/core/resolve.ts';
import { hatchMd } from '../helpers.ts';

const BASE = ['namespace f {', 'void a() {', '  one();', '}', '}', ''].join('\n');
const NEW = ['namespace f {', 'void a() {', '  one();', '  two();', '}', '}', ''].join('\n');

function ok(response: ResponseMessage): Record<string, unknown> {
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(response.ok);
  return response.result as Record<string, unknown>;
}

function failed(response: ResponseMessage): ServiceError {
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.ok(!response.ok);
  return response.error;
}

// ── handshake ────────────────────────────────────────────────────────────────

test('service version: номер протокола, версия hatch и список языков', async () => {
  const result = ok(await handle({ id: 1, method: 'version' }));
  assert.equal(result['protocol'], PROTOCOL_VERSION);
  assert.match(String(result['hatch']), /^\d+\.\d+\.\d+/);
  assert.ok((result['languages'] as string[]).includes('cpp'));
  assert.equal(typeof result['configSchema'], 'number');
});

test('service: неизвестный метод — отказ вызова, а не падение', async () => {
  const error = failed(await handle({ id: 2, method: 'nosuch' }));
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /known: version, generate, resolve, apply/);
});

test('service: params не объект — отказ с внятным текстом', async () => {
  const error = failed(await handle({ id: 3, method: 'resolve' }));
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /needs params/);
});

// ── generate ─────────────────────────────────────────────────────────────────

test('service generate: .md, координаты ханков и подтверждение воспроизводимости', async () => {
  const result = ok(
    await handle({
      id: 4,
      method: 'generate',
      params: { baseText: BASE, newText: NEW, language: 'cpp' },
    }),
  );

  assert.match(String(result['md']), /^# match cpp$/m);
  assert.equal(result['reproducesNew'], true, 'патч воспроизводит новый текст');

  const hunks = result['hunks'] as HunkLink[];
  assert.ok(hunks.length >= 1);
  for (const hunk of hunks) {
    assert.equal(hunk.status, 'ok');
    assert.ok(hunk.mdSpan !== undefined, 'координаты в .md');
    assert.ok(hunk.base !== undefined && hunk.final !== undefined, 'координаты по обе стороны');
  }
  assert.ok(NEW.includes(hunks[0]!.finalText!.trim()), 'вставленный текст есть в новом файле');
});

test('service generate: язык берётся из path, когда не задан явно', async () => {
  const result = ok(
    await handle({
      id: 5,
      method: 'generate',
      params: { baseText: BASE, newText: NEW, path: 'chrome/browser/feature_list.cc' },
    }),
  );
  assert.match(String(result['md']), /^# match cpp$/m);
});

test('service generate: прогресс идёт отдельными сообщениями, не ответом', async () => {
  const progress: ProgressMessage[] = [];
  const response = await handle(
    { id: 6, method: 'generate', params: { baseText: BASE, newText: NEW, language: 'cpp' } },
    (message) => progress.push(message),
  );

  ok(response);
  assert.ok(progress.length >= 1, 'хотя бы один сегмент');
  for (const message of progress) {
    assert.equal(message.method, 'progress');
    assert.equal(message.params.id, 6, 'прогресс помечен id своего запроса');
    assert.ok(message.params.done <= message.params.total);
  }
});

// ── resolve и apply ──────────────────────────────────────────────────────────

test('service resolve: язык читается из заголовка # match, path не нужен', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const result = ok(await handle({ id: 7, method: 'resolve', params: { md, baseText: BASE } }));

  const hunks = result['hunks'] as HunkLink[];
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]!.status, 'ok');
  assert.equal(hunks[0]!.finalText, 'two();');
});

test('service resolve: сломанный якорь — вызов успешен, ханк помечен отказом', async () => {
  const md = hatchMd([{ match: '... nosuchcall(); >>> ...', patch: 'X();' }]);
  const result = ok(await handle({ id: 8, method: 'resolve', params: { md, baseText: BASE } }));

  const hunk = (result['hunks'] as HunkLink[])[0]!;
  assert.equal(hunk.status, 'no-match');
  assert.equal(hunk.failure!.kind, 'MatchError');
  assert.equal(typeof hunk.failure!.origPos, 'number');
});

test('service resolve: .md не разбирается — отказ ВЫЗОВА со строкой ошибки', async () => {
  const error = failed(
    await handle({ id: 9, method: 'resolve', params: { md: '# match cpp\nбез жёлоба\n# end\n', baseText: BASE } }),
  );
  assert.equal(error.kind, 'ParseError');
  assert.equal(error.exitCode, 2);
  assert.equal(error.detail!['mdLine'], 2);
});

test('service apply: отдаёт получившийся текст вместе с координатами', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const result = ok(await handle({ id: 10, method: 'apply', params: { md, baseText: BASE } }));

  assert.ok(String(result['text']).includes('one();two();'), String(result['text']));
  assert.equal((result['hunks'] as HunkLink[]).length, 1);
});

// ── труба целиком ────────────────────────────────────────────────────────────

test('serve: одна строка JSON — один ответ строкой, порядок сохранён', async () => {
  const lines: string[] = [];
  const input = readableOf([
    JSON.stringify({ id: 1, method: 'version' }),
    '',
    'не json',
    JSON.stringify({ id: 2, method: 'version' }),
  ]);

  await serve(input, writableTo(lines));

  const answers = lines.map((l) => JSON.parse(l) as ResponseMessage);
  assert.deepEqual(
    answers.map((a) => a.id),
    [1, 0, 2],
    'пустая строка пропущена, мусор получил ответ с id 0',
  );
  assert.equal(answers[1]!.ok, false);
});

test('serve: процесс отвечает на version и не пишет ничего лишнего в stdout', () => {
  const entry = fileURLToPath(new URL('../../src/service/index.ts', import.meta.url));
  const stdout = execFileSync('node', ['--experimental-strip-types', entry], {
    input: `${JSON.stringify({ id: 1, method: 'version' })}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, stdout);
  const response = JSON.parse(lines[0]!) as ResponseMessage;
  assert.ok(response.ok);
  assert.equal((response.result as Record<string, unknown>)['protocol'], PROTOCOL_VERSION);
});

// ── потоки для теста трубы ───────────────────────────────────────────────────

function readableOf(lines: readonly string[]): NodeJS.ReadableStream {
  return Readable.from([`${lines.join('\n')}\n`]);
}

function writableTo(sink: string[]): NodeJS.WritableStream {
  return new Writable({
    write(chunk: Buffer, _encoding: string, done: () => void) {
      for (const line of String(chunk).split('\n')) if (line !== '') sink.push(line);
      done();
    },
  });
}
