import { test } from 'node:test';
import assert from 'node:assert/strict';

import { steerSynthesis } from '../../src/generate/steer.ts';
import type { Steering, Verdict } from '../../src/generate/steer.ts';
import { synthesize } from '../../src/generate/synth.ts';
import { printHatchFile } from '../../src/generate/printer.ts';
import { parseHatchFile } from '../../src/core/hatch-parser.ts';
import { resolveHunks } from '../../src/core/resolve.ts';
import { SynthesisError } from '../../src/core/errors.ts';
import { cppAdapter } from '../../src/lang/cpp/index.ts';

// The person is played by the test: what they answer, and what they type into the
// editor, scripted; what hatch asked and showed them, recorded.

interface Script {
  readonly verdicts?: Verdict[];
  readonly offers?: boolean[];
  readonly edits?: ((shown: string) => string)[];
}

function person(script: Script): { steering: Steering; asked: string[]; shown: string[] } {
  const verdicts = [...(script.verdicts ?? [])];
  const offers = [...(script.offers ?? [])];
  const edits = [...(script.edits ?? [])];
  const asked: string[] = [];
  const shown: string[] = [];
  const steering: Steering = {
    ...(script.verdicts !== undefined ? { review: () => Promise.resolve(verdicts.shift() ?? 'keep') } : {}),
    offerEdit: (why) => (asked.push(why), Promise.resolve(offers.shift() ?? false)),
    edit: (text) => {
      shown.push(text);
      const next = edits.shift();
      return Promise.resolve(next === undefined ? text : next(text));
    },
  };
  return { steering, asked, shown };
}

async function steer(oldText: string, newText: string, script: Script) {
  await cppAdapter.init();
  const who = person(script);
  const run = steerSynthesis({ oldText, newText, adapter: cppAdapter, label: 'cpp', bridgeGap: 0, exact: false }, who.steering);
  return { run, ...who };
}

function applied(oldText: string, hunks: readonly unknown[]): string {
  const file = parseHatchFile(printHatchFile(hunks as never, 'cpp'));
  const { links, applied: text } = resolveHunks(oldText, file, cppAdapter);
  assert.ok(links.every((l) => l.status === 'ok'), JSON.stringify(links.map((l) => l.status)));
  return text;
}

const OLD = 'void f() {\n  a();\n}\n\nvoid g() {\n  b();\n}\n';
const NEW = 'void f() {\n  a2();\n}\n\nvoid g() {\n  b2();\n}\n';

test('steer: nobody objecting, the hunks give the new version, as synthesize does', async () => {
  const { run } = await steer(OLD, NEW, {});
  const result = await run;
  assert.equal(result.reproducesNew, true);
  assert.equal(applied(OLD, result.hunks), NEW);
  assert.equal(result.hunks.length, synthesize(OLD, NEW, cppAdapter).length);
});

test('steer: a change left out is not in the .md, and the next hunks are built without it', async () => {
  // Two insertions where the second leans on the first (golden cpp/41's shape): left
  // out after the fact, the second did not land; built without it, it does.
  const old = 'void f() {\n  step();\n  step();\n  step();\n}\n';
  const neu = 'void f() {\n  step(5);\n  step();\n  step();\n  done();\n}\n';
  const { run } = await steer(old, neu, { verdicts: ['skip', 'keep'] });
  const result = await run;
  assert.equal(result.reproducesNew, false);
  const text = applied(old, result.hunks); // every hunk lands — no more "left out, the rest broke"
  assert.ok(!text.includes('step(5)'), 'the change left out is not there');
  assert.ok(text.includes('done();'), 'the change after it is');
});

test('steer: a declined hunk goes to the editor; what comes back — patch body too — is the new state', async () => {
  const { run, asked, shown } = await steer(OLD, NEW, {
    verdicts: ['decline', 'keep'],
    offers: [true],
    edits: [(text) => text.replace('    a2();', '    a3();')],
  });
  const result = await run;
  assert.match(asked[0]!, /hunk 1: declined/);
  assert.match(shown[0]!, /hunk 1: declined/);
  assert.match(shown[0]!, /^  - {3}a\(\);$/m, 'the change is quoted above the hunks');
  assert.equal(applied(OLD, result.hunks), NEW.replace('a2();', 'a3();'), 'the edited body stays; g() still gets its hunk');
  assert.equal(result.reproducesNew, false);
});

test('steer: a # note written in the editor stays with its hunk — in the hunks and in the printed patch', async () => {
  const { run } = await steer(OLD, NEW, {
    verdicts: ['decline', 'keep'],
    offers: [true],
    edits: [(text) => text.replace(/^# match cpp$/m, '# note\nwhy a2: the old name is gone upstream\n# end\n# match cpp')],
  });
  const result = await run;
  assert.equal(result.hunks[0]!.note?.text, 'why a2: the old name is gone upstream');
  const printed = printHatchFile(result.hunks, 'cpp');
  assert.match(printed, /^# note\nwhy a2: the old name is gone upstream\n# end\n# match cpp$/m);
  assert.equal(parseHatchFile(printed).hunks[0]!.note?.text, 'why a2: the old name is gone upstream');
  assert.equal(applied(OLD, result.hunks), NEW);
});

test('steer: declined and no editor wanted — the run stops, nothing is written', async () => {
  const { run } = await steer(OLD, NEW, { verdicts: ['decline'], offers: [false] });
  await assert.rejects(run, /hunk 1: declined — nothing was written/);
});

test('steer: an edit that does not stand is shown with its reason, and edited again', async () => {
  const { run, asked, shown } = await steer(OLD, NEW, {
    verdicts: ['decline', 'keep'],
    offers: [true, true],
    edits: [
      (text) => text.replace('# end', 'end'),
      (text) => text.replace(/^end$/m, '# end').replace('    a2();', '    a3();'),
    ],
  });
  const result = await run;
  assert.match(asked[1]!, /the edited patch does not parse/);
  assert.match(shown[1]!, /the edited patch does not parse/, 'the reason is on top of the next edit');
  assert.ok(!shown[1]!.includes('hunk 1: declined'), 'the old reason is replaced');
  assert.equal(applied(OLD, result.hunks), NEW.replace('a2();', 'a3();'));
});

test('steer: an edit that does not land names the hunk and the line', async () => {
  const { run, asked } = await steer(OLD, NEW, {
    verdicts: ['decline'],
    offers: [true, false],
    edits: [(text) => text.replace('void f() {', 'void nope() {')],
  });
  await assert.rejects(run, /hunk 1 \(line \d+\) does not land/);
  assert.match(asked[1]!, /hunk 1 \(line \d+\) does not land/);
});

// Golden cpp/57's shape: two identical if-blocks, the change in the second — synthesis
// cannot anchor it.
const TWIN_OLD =
  'void f() {\n  if (cond) {\n    a();\n    work();\n  }\n  if (cond) {\n    a();\n    work();\n  }\n}\n';
const TWIN_NEW = TWIN_OLD.replace(/work\(\);(?![\s\S]*work\(\);)/, 'work(2);');
const BY_HAND = [
  '# match cpp',
  '    ...',
  '    if (cond) {',
  '    ...',
  '    }',
  '    ...',
  '    if (cond) {',
  '    ...',
  '    >>>',
  '    work();',
  '    <<<',
  '    ...',
  '# end',
  '# patch',
  '    work(2);',
  '# end',
  '',
].join('\n');

test('steer: a change synthesis cannot anchor is offered to the editor, and a hand hunk takes its place', async () => {
  await cppAdapter.init();
  assert.throws(() => synthesize(TWIN_OLD, TWIN_NEW, cppAdapter), (e) => e instanceof SynthesisError);
  const { run, asked, shown } = await steer(TWIN_OLD, TWIN_NEW, { offers: [true], edits: [() => BY_HAND] });
  const result = await run;
  assert.match(asked[0]!, /hunk 1: the change at line \d+ could not be anchored/);
  assert.match(shown[0]!, /could not be anchored/);
  assert.match(shown[0]!, /^# match cpp$/m, 'a hunk to start from is there');
  assert.equal(result.reproducesNew, true);
  assert.equal(applied(TWIN_OLD, result.hunks), TWIN_NEW);
});

test('steer: the editor shows EVERY hunk so far, not only the one that failed', async () => {
  const old = `void head() {\n  x();\n}\n\n${TWIN_OLD}`;
  const neu = `void head() {\n  x2();\n}\n\n${TWIN_NEW}`;
  const { run, shown } = await steer(old, neu, { offers: [true], edits: [(t) => t.replace(/# match cpp[\s\S]*$/, (all) => all.slice(0, all.lastIndexOf('# match cpp')) + BY_HAND)] });
  const result = await run;
  assert.equal((shown[0]!.match(/^# match cpp$/gm) ?? []).length, 2, 'the hunk for head() and the one to write');
  assert.equal(applied(old, result.hunks), neu);
});

test('steer: a change that cannot be anchored, and no editor wanted — the synthesis error itself', async () => {
  const { run } = await steer(TWIN_OLD, TWIN_NEW, { offers: [false] });
  await assert.rejects(run, (e) => e instanceof SynthesisError);
});
