// Python СКВОЗЬ настоящий конвейер: parser → matcher → patcher. Здесь проверяется
// what phase 5 exists for: the matcher and
// патчер НЕ знают про отступы, всю питонью специфику несёт адаптер. `core/` ради
// Python не менялся — если бы менялся, граница core↔lang была бы проведена неверно
// (00-general-rules §1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHatchFile } from '../../../src/core/hatch-parser.ts';
import { pythonAdapter } from '../../../src/lang/python/index.ts';
import { adapterForLanguage } from '../../../src/lang/adapter.ts';
import { applyAll } from '../../../src/cli/apply.ts';
import { hatchMd } from '../../helpers.ts';

const SRC = `def first(x):
    if x:
        log("a")
    return x

def second(x):
    if x:
        log("b")
    return x
`;

test('a heading with a level anchor pins the edit INSIDE the wanted function', async () => {
  await pythonAdapter.init();
  // `def second(x):` вводит В ТЕЛО: двоеточие — открывашка Python, ровно как `{` в C++
  const file = parseHatchFile(
    hatchMd(
      [{ match: '...\ndef second(x):\n...\n        log("b")\n>>>\n...', patch: '\n    log("c")' }],
      'python',
    ),
  );
  const { source, edits } = applyAll(SRC, file, pythonAdapter);
  assert.equal(edits.length, 1);
  // вставка попала во ВТОРУЮ функцию и на СВОЙ уровень; первая не тронута
  assert.match(source, /def second\(x\):\n {4}if x:\n {8}log\("b"\)\n {4}log\("c"\)\n {4}return x/);
  assert.match(source, /def first\(x\):\n {4}if x:\n {8}log\("a"\)\n {4}return x/);
});

test('the level is held by the multiline literal: `\\n` + indentation is text of the canon', async () => {
  await pythonAdapter.init();
  // тот же якорь, но `return x` записан на уровне ТЕЛА if (отступ 8) — такого в файле нет
  const wrong = parseHatchFile(
    hatchMd(
      [{ match: '...\n        log("b")\n        return x\n>>>\n...', patch: '\nX' }],
      'python',
    ),
  );
  assert.throws(() => applyAll(SRC, wrong, pythonAdapter), /no match/);

  // а на своём уровне (отступ 4) — совпадает
  const right = parseHatchFile(
    hatchMd([{ match: '...\n        log("b")\n    return x\n>>>\n...', patch: '\nX' }], 'python'),
  );
  assert.equal(applyAll(SRC, right, pythonAdapter).edits.length, 1);
});

test('an edit inside a body without a level anchor is AMBIGUOUS (two identical functions)', async () => {
  await pythonAdapter.init();
  const file = parseHatchFile(
    hatchMd([{ match: '...\n    if x:\n>>>\n...', patch: '        log("c")' }], 'python'),
  );
  assert.throws(() => applyAll(SRC, file, pythonAdapter), /ambiguous/);
});

test('replacing a range: `>>> … <<<` throws away the old body of the branch', async () => {
  await pythonAdapter.init();
  const file = parseHatchFile(
    hatchMd(
      [{ match: '...\ndef first(x):\n...\n>>>\n        log("a")\n<<<\n...', patch: '        log("z")' }],
      'python',
    ),
  );
  const { source } = applyAll(SRC, file, pythonAdapter);
  assert.ok(source.includes('log("z")'), source);
  assert.ok(!source.includes('log("a")'), source);
  assert.ok(source.includes('log("b")'), source); // вторая функция не тронута
});

test('the language of the heading is enough: the adapter is chosen without a file name', () => {
  const file = parseHatchFile(hatchMd([{ match: '... x >>> ...', patch: 'y' }], 'python'));
  assert.equal(file.language, 'python');
  assert.equal(adapterForLanguage(file.language), pythonAdapter);
});
