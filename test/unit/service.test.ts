import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { CONFIG_VERSION, configTemplate, schemaVersions } from '../../src/infra/config/index.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { handle } from '../../src/service/handler.ts';
import { serve } from '../../src/service/index.ts';
import { PROTOCOL_VERSION } from '../../src/service/protocol.ts';
import type { ProgressMessage, ResponseMessage, ServiceError } from '../../src/service/protocol.ts';
import type { HunkLink } from '../../src/core/resolve.ts';
import { hatchMd } from '../helpers.ts';
import { buildRepo, version } from '../git-repo.ts';
import type { Repo } from '../git-repo.ts';

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

test('service version: the protocol number, the hatch version and the languages', async () => {
  const result = ok(await handle({ id: 1, method: 'version' }));
  assert.equal(result['protocol'], PROTOCOL_VERSION);
  assert.match(String(result['hatch']), /^\d+\.\d+\.\d+/);
  assert.ok((result['languages'] as string[]).includes('cpp'));
  assert.equal(typeof result['configSchema'], 'number');
});

test('service: an unknown method is a refused call, not a crash', async () => {
  const error = failed(await handle({ id: 2, method: 'nosuch' }));
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /known: version, generate, resolve, apply/);
});

test('service: params that are not an object are refused in plain words', async () => {
  const error = failed(await handle({ id: 3, method: 'resolve' }));
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /needs params/);
});

// ── generate ─────────────────────────────────────────────────────────────────

test('service generate: the .md, the hunk coordinates and the reproducibility flag', async () => {
  const result = ok(
    await handle({
      id: 4,
      method: 'generate',
      params: { baseText: BASE, newText: NEW, language: 'cpp' },
    }),
  );

  assert.match(String(result['md']), /^# match cpp$/m);
  assert.equal(result['reproducesNew'], true, 'the patch reproduces the new text');

  const hunks = result['hunks'] as HunkLink[];
  assert.ok(hunks.length >= 1);
  for (const hunk of hunks) {
    assert.equal(hunk.status, 'ok');
    assert.ok(hunk.mdSpan !== undefined, 'coordinates in the .md');
    assert.ok(hunk.base !== undefined && hunk.final !== undefined, 'coordinates on both sides');
  }
  assert.ok(NEW.includes(hunks[0]!.finalText!.trim()), 'the inserted text is there in the new file');
});

test('service generate: the language comes from path when none is given', async () => {
  const result = ok(
    await handle({
      id: 5,
      method: 'generate',
      params: { baseText: BASE, newText: NEW, path: join(tmpdir(), 'chrome', 'browser', 'feature_list.cc') },
    }),
  );
  assert.match(String(result['md']), /^# match cpp$/m);
});

// ── generate: the base named in git instead of sent ──────────────────────────

async function generateGit(
  repo: Repo,
  params: Record<string, unknown>,
  id = 30,
): Promise<ResponseMessage> {
  return handle({
    id,
    method: 'generate',
    params: { newText: version(4), language: 'cpp', path: repo.inPath, ...params },
  });
}

test('service generate: baseGit {} is the last commit of the branch we are on', async () => {
  const repo = buildRepo('hatch-svc-git-');
  try {
    const result = ok(await generateGit(repo, { baseGit: {} }));
    assert.equal(result['baseSpec'], 'HEAD:src/core/f.cc');
    assert.equal(result['reproducesNew'], true);
    assert.match(String(result['md']), /int a = 4;/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: every coordinate travels, and the reply says what was read', async () => {
  const repo = buildRepo('hatch-svc-coords-');
  try {
    const byCommit = ok(await generateGit(repo, { baseGit: { commit: repo.a } }));
    assert.equal(byCommit['baseSpec'], `${repo.a}:src/core/f.cc`);

    const byBranch = ok(await generateGit(repo, { baseGit: { branch: 'side' } }));
    assert.equal(byBranch['baseSpec'], 'side:src/core/f.cc');

    const byPath = ok(await generateGit(repo, { baseGit: { repoPath: 'src/core/other.cc' } }));
    assert.equal(byPath['baseSpec'], 'HEAD:src/core/other.cc');

    const all = ok(await generateGit(repo, {
      baseGit: { branch: 'side', commit: repo.s, repoPath: 'src/core/side-only.cc' },
    }));
    assert.equal(all['baseSpec'], `${repo.s}:src/core/side-only.cc`);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: a base sent as text still reports no git spec', async () => {
  const result = ok(
    await handle({ id: 31, method: 'generate', params: { baseText: BASE, newText: NEW, language: 'cpp' } }),
  );
  assert.equal(result['baseSpec'], null);
});

test('service generate: exactly one base — neither and both are refused', async () => {
  const repo = buildRepo('hatch-svc-one-');
  try {
    const both = failed(await generateGit(repo, { baseText: BASE, baseGit: {} }));
    assert.equal(both.kind, 'BadRequest');
    assert.match(both.message, /exactly one base/);

    const neither = failed(await generateGit(repo, {}));
    assert.equal(neither.kind, 'BadRequest');
    assert.match(neither.message, /exactly one base/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: no base sent — the one generate.base names in the config (schema 2)', async () => {
  const repo = buildRepo('hatch-svc-cfgbase-');
  try {
    writeFileSync(
      join(repo.dir, 'hatch.config.json'),
      JSON.stringify({ version: 2, generate: { base: { commit: repo.a } } }),
    );
    const fromConfig = ok(await generateGit(repo, {}));
    assert.equal(fromConfig['baseSpec'], `${repo.a}:src/core/f.cc`);
    const config = fromConfig['config'] as { origins: Record<string, string> };
    assert.match(config.origins['generate.base.commit']!, /^config /);

    // A base in the request replaces the config's whole, and the origins say so.
    const sent = ok(await generateGit(repo, { baseGit: { branch: 'side' } }));
    assert.equal(sent['baseSpec'], 'side:src/core/f.cc');
    const origins = (sent['config'] as { origins: Record<string, string> }).origins;
    assert.equal(origins['generate.base.commit'], 'flag params.baseGit');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: baseGit without a path cannot know which repository, and says so', async () => {
  const error = failed(
    await handle({ id: 32, method: 'generate', params: { newText: NEW, language: 'cpp', baseGit: {} } }),
  );
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /params\.baseGit needs params\.path/);
});

test('service generate: a baseGit that is not a coordinate object is refused by name', async () => {
  const repo = buildRepo('hatch-svc-shape-');
  try {
    for (const [baseGit, expected] of [
      ['side', /must be an object/],
      [{ ref: 'side' }, /has no field 'ref'; known: branch, commit, repoPath/],
      [{ branch: 5 }, /params\.baseGit\.branch must be a non-empty string/],
      [{ commit: '' }, /params\.baseGit\.commit must be a non-empty string/],
    ] as const) {
      const error = failed(await generateGit(repo, { baseGit }));
      assert.equal(error.kind, 'BadRequest', JSON.stringify(baseGit));
      assert.match(error.message, expected);
    }
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: a git refusal crosses the wire as GitError, with the revision', async () => {
  const repo = buildRepo('hatch-svc-refuse-');
  try {
    const error = failed(await generateGit(repo, { baseGit: { branch: 'nope' } }));
    assert.equal(error.kind, 'GitError');
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /--branch nope: no such branch/);
    assert.equal(error.detail?.['revision'], 'nope');

    const off = failed(await generateGit(repo, { baseGit: { branch: repo.branch, commit: repo.s } }));
    assert.equal(off.kind, 'GitError');
    assert.match(off.message, /is not on branch/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service resolve and apply: the base named in git, and the reply says what was read', async () => {
  const repo = buildRepo('hatch-svc-apply-');
  try {
    const md = hatchMd([{ match: '... int a = 2; >>> ...', patch: 'X();' }]);
    const params = { md, path: repo.inPath, language: 'cpp', baseGit: {} };

    const applied = ok(await handle({ id: 40, method: 'apply', params }));
    assert.equal(applied['baseSpec'], 'HEAD:src/core/f.cc');
    assert.ok(String(applied['text']).includes('int a = 2;X();'));

    const resolved = ok(await handle({ id: 41, method: 'resolve', params: { ...params, baseGit: { commit: repo.b } } }));
    assert.equal(resolved['baseSpec'], `${repo.b}:src/core/f.cc`);
    assert.equal((resolved['hunks'] as HunkLink[])[0]!.status, 'ok');

    const sent = ok(await handle({ id: 42, method: 'apply', params: { md, baseText: version(2), language: 'cpp' } }));
    assert.equal(sent['baseSpec'], null);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service apply: the same one-base rule, and a pipe has nobody to ask', async () => {
  const repo = buildRepo('hatch-svc-apply-rules-');
  try {
    const md = hatchMd([{ match: '... int a = 2; >>> ...', patch: 'X();' }]);
    const both = failed(await handle({ id: 43, method: 'apply',
      params: { md, path: repo.inPath, language: 'cpp', baseText: 'x', baseGit: {} } }));
    assert.match(both.message, /exactly one base/);

    const off = failed(await handle({ id: 44, method: 'resolve',
      params: { md, path: repo.inPath, language: 'cpp', baseGit: { branch: repo.branch, commit: repo.s } } }));
    assert.equal(off.kind, 'GitError', 'refused: there is no terminal on a pipe to agree');
    assert.match(off.message, /is not on branch/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('service generate: progress arrives as its own messages, never as the reply', async () => {
  const progress: ProgressMessage[] = [];
  const response = await handle(
    { id: 6, method: 'generate', params: { baseText: BASE, newText: NEW, language: 'cpp' } },
    (message) => progress.push(message),
  );

  ok(response);
  assert.ok(progress.length >= 1, 'at least one segment');
  for (const message of progress) {
    assert.equal(message.method, 'progress');
    assert.equal(message.params.id, 6, 'progress carries the id of its own request');
    assert.ok(message.params.done <= message.params.total);
  }
});

// ── config: the same layering the CLI uses ────────────────────────────────────

interface Project {
  readonly dir: string;
  readonly file: string;
  readonly cleanup: () => void;
}

function project(config: string | undefined): Project {
  const dir = mkdtempSync(join(tmpdir(), 'hatch-service-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'src'));
  if (config !== undefined) writeFileSync(join(dir, 'hatch.config.json'), config);
  return {
    dir,
    file: join(dir, 'src', 'a.cc'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function generated(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return ok(await handle({ id: 20, method: 'generate', params: { baseText: BASE, newText: NEW, language: 'cpp', ...params } }));
}

test('service generate: hatch.config.json is found upwards from the file and applied', async () => {
  const p = project('{"version":1,"generate":{"bridgeGap":3,"siblings":{"min":2}}}');
  try {
    const result = await generated({ path: p.file });
    const config = result['config'] as { file: string; settings: Record<string, unknown>; origins: Record<string, string> };

    assert.equal(config.file, join(p.dir, 'hatch.config.json'));
    assert.equal(config.settings['bridgeGap'], 3);
    assert.equal(config.settings['minSiblings'], 2);
    assert.match(config.origins['generate.bridgeGap']!, /^config /);
  } finally {
    p.cleanup();
  }
});

test('service generate: a sent param beats the config, as a flag beats the file', async () => {
  const p = project('{"version":1,"generate":{"bridgeGap":3}}');
  try {
    const result = await generated({ path: p.file, bridgeGap: 0 });
    const config = result['config'] as { settings: Record<string, unknown>; origins: Record<string, string> };

    assert.equal(config.settings['bridgeGap'], 0);
    assert.equal(config.origins['generate.bridgeGap'], 'flag params.bridgeGap');
  } finally {
    p.cleanup();
  }
});

test('service generate: a RELATIVE path is refused, not silently stripped of its config', async () => {
  const p = project('{"version":1,"generate":{"bridgeGap":3}}');
  try {
    const error = failed(
      await handle({ id: 40, method: 'generate', params: { baseText: BASE, newText: NEW, path: 'a.cc' } }),
    );
    assert.equal(error.kind, 'BadRequest');
    assert.match(error.message, /must be absolute/);
  } finally {
    p.cleanup();
  }
});

test('service resolve: a relative path is refused there too', async () => {
  const error = failed(
    await handle({
      id: 41,
      method: 'resolve',
      params: { md: hatchMd([{ match: '...\n>>>\n  one();\n...' }]), baseText: BASE, path: 'a.cc' },
    }),
  );
  assert.equal(error.kind, 'BadRequest');
  assert.match(error.message, /must be absolute/);
});

test('service generate: a broken config refuses the CALL and names the file in detail', async () => {
  const p = project('{"version":1,"generate":{"nosuchkey":1}}');
  try {
    const error = failed(
      await handle({
        id: 21,
        method: 'generate',
        params: { baseText: BASE, newText: NEW, language: 'cpp', path: p.file },
      }),
    );
    assert.equal(error.kind, 'ConfigError');
    assert.equal(error.exitCode, 5);
    assert.equal(error.detail!['file'], join(p.dir, 'hatch.config.json'));
  } finally {
    p.cleanup();
  }
});

// ── resolve and apply ─────────────────────────────────────────────────────────

test('service resolve: the language is read from the # match heading, no path needed', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const result = ok(await handle({ id: 7, method: 'resolve', params: { md, baseText: BASE } }));

  const hunks = result['hunks'] as HunkLink[];
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]!.status, 'ok');
  assert.equal(hunks[0]!.finalText, 'two();');
});

test('service resolve: a broken anchor keeps the call fine and marks the hunk failed', async () => {
  const md = hatchMd([{ match: '... nosuchcall(); >>> ...', patch: 'X();' }]);
  const result = ok(await handle({ id: 8, method: 'resolve', params: { md, baseText: BASE } }));

  const hunk = (result['hunks'] as HunkLink[])[0]!;
  assert.equal(hunk.status, 'no-match');
  assert.equal(hunk.failure!.kind, 'MatchError');
  assert.equal(typeof hunk.failure!.origPos, 'number');
});

test('service resolve: an unparsable .md refuses the CALL and gives the line', async () => {
  const error = failed(
    await handle({ id: 9, method: 'resolve', params: { md: '# match cpp\nno gutter here\n# end\n', baseText: BASE } }),
  );
  assert.equal(error.kind, 'ParseError');
  assert.equal(error.exitCode, 2);
  assert.equal(error.detail!['mdLine'], 2);
});

test('service apply: hands back the resulting text along with the coordinates', async () => {
  const md = hatchMd([{ match: '... one(); >>> ...', patch: 'two();' }]);
  const result = ok(await handle({ id: 10, method: 'apply', params: { md, baseText: BASE } }));

  assert.ok(String(result['text']).includes('one();two();'), String(result['text']));
  assert.equal((result['hunks'] as HunkLink[]).length, 1);
});

// ── the pipe end to end ───────────────────────────────────────────────────────

test('serve: one JSON line in, one line out, in order', async () => {
  const lines: string[] = [];
  const input = readableOf([
    JSON.stringify({ id: 1, method: 'version' }),
    '',
    'not json',
    JSON.stringify({ id: 2, method: 'version' }),
  ]);

  await serve(input, writableTo(lines));

  const answers = lines.map((l) => JSON.parse(l) as ResponseMessage);
  assert.deepEqual(
    answers.map((a) => a.id),
    [1, 0, 2],
    'the blank line is skipped and the junk gets an answer with id 0',
  );
  assert.equal(answers[1]!.ok, false);
});

test('serve: the process answers version and writes nothing else to stdout', () => {
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

// ── streams for the pipe test ─────────────────────────────────────────────────

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

test('service generate: outPath follows generate.out and generate.mirror', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hatch-service-mirror-'));
  try {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'chromium_src', 'browser'), { recursive: true });
    writeFileSync(join(root, 'hatch.config.json'), '{"version":1,"generate":{"out":"patches","mirror":true}}');
    const file = join(root, 'chromium_src', 'browser', 'a.cc');
    writeFileSync(file, BASE);

    const result = ok(
      await handle({ id: 30, method: 'generate', params: { baseText: BASE, newText: NEW, path: file } }),
    );
    assert.equal(result['outPath'], join(root, 'patches', 'chromium_src', 'browser', 'a.cc.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service generate: mirroring without an output root is a call-level failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hatch-service-mirror-'));
  try {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'hatch.config.json'), '{"version":1,"generate":{"mirror":true}}');
    const file = join(root, 'a.cc');
    writeFileSync(file, BASE);

    const error = failed(
      await handle({ id: 31, method: 'generate', params: { baseText: BASE, newText: NEW, path: file } }),
    );
    assert.equal(error.kind, 'ConfigError');
    assert.match(error.message, /needs an output root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service generate: without a config the patch belongs next to its file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hatch-service-plain-'));
  try {
    mkdirSync(join(root, '.git'));
    const file = join(root, 'a.cc');
    writeFileSync(file, BASE);

    const result = ok(
      await handle({ id: 32, method: 'generate', params: { baseText: BASE, newText: NEW, path: file } }),
    );
    assert.equal(result['outPath'], `${file}.md`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service generate: a file where a directory has to go is named, not left to the client', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hatch-service-block-'));
  try {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'patches'), 'x');
    writeFileSync(join(root, 'hatch.config.json'), '{"version":1,"generate":{"out":"patches","mirror":true}}');
    const file = join(root, 'a.cc');
    writeFileSync(file, BASE);

    const error = failed(
      await handle({ id: 33, method: 'generate', params: { baseText: BASE, newText: NEW, path: file } }),
    );
    assert.equal(error.kind, 'PathError');
    assert.equal(error.exitCode, 1);
    assert.equal(error.detail!['blocker'], join(root, 'patches'));
    assert.match(error.message, /is a file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('service: language "" is no language — generate and resolve alike go by the path', async () => {
  const gen = await handle({
    id: 1,
    method: 'generate',
    params: { newText: 'int a = 2;\n', baseText: 'int a = 1;\n', language: '', path: '/abs/x.cc' },
  });
  assert.ok(gen.ok, JSON.stringify(gen));
  const md = (gen.result as { md: string }).md;
  assert.match(md, /^# match cpp$/m);
  const res = await handle({
    id: 2,
    method: 'resolve',
    params: { md: md.replace('# match cpp', '# match'), baseText: 'int a = 1;\n', language: '', path: '/abs/x.cc' },
  });
  assert.ok(res.ok, JSON.stringify(res));
});

// ── configTemplate (protocol 4) ──────────────────────────────────────────────

test('configTemplate: the text, where the core would look, whether it is there, every version', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hatch-svc-cfg-')));
  try {
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.cpp'), '');
    const result = ok(
      await handle({ id: 1, method: 'configTemplate', params: { path: join(dir, 'src', 'a.cpp'), settings: { 'generate.out': 'patches/' } } }),
    );
    assert.equal(result['text'], configTemplate({ settings: { generate: { out: 'patches/' } } }).text);
    assert.equal(result['version'], CONFIG_VERSION);
    assert.equal(result['suggestedPath'], join(dir, 'hatch.config.json'));
    assert.equal(result['exists'], false);
    assert.deepEqual(result['versions'], schemaVersions());

    writeFileSync(join(dir, 'hatch.config.json'), '{}');
    const again = ok(await handle({ id: 2, method: 'configTemplate', params: { path: dir } }));
    assert.equal(again['exists'], true, 'a folder as path works too');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configTemplate: path must be absolute; a bad key is a ConfigError listing every key', async () => {
  assert.equal(failed(await handle({ id: 1, method: 'configTemplate', params: { path: 'rel' } })).kind, 'BadRequest');
  assert.equal(failed(await handle({ id: 1, method: 'configTemplate', params: {} })).kind, 'BadRequest');
  const error = failed(
    await handle({ id: 1, method: 'configTemplate', params: { path: tmpdir(), settings: { generate: { a: 1, b: 2 } } } }),
  );
  assert.equal(error.kind, 'ConfigError');
  assert.equal(error.exitCode, 5);
  assert.deepEqual(error.detail, {
    version: CONFIG_VERSION,
    keys: [
      { path: 'generate.a', since: null, until: null },
      { path: 'generate.b', since: null, until: null },
    ],
  });
  const newer = failed(await handle({ id: 1, method: 'configTemplate', params: { path: tmpdir(), version: CONFIG_VERSION + 1 } }));
  assert.match(newer.message, /update hatch/);
});
