// ============================================================================
// examples/dump-ast.ts — взять .md и напечатать разобранный AST (HatchFile).
// Запуск:  node --experimental-strip-types examples/dump-ast.ts путь/к/patch.md
// Без аргумента берётся встроенный пример.
// ============================================================================
import { readFileSync } from 'node:fs';
import { parseHatchFile } from '../src/core/parser.ts';
import { printPattern } from '../src/core/printer.ts';

const path = "/Users/varakinde/PycharmProjects/Hatch/test/PassedTests/unique14.md"

const md =
  path !== undefined
    ? readFileSync(path, 'utf8')
    : [
        '# match',
        '```cpp',
        'namespace features {',
        '...',
        'kFooFeature,',
        '>>>',
        '}',
        '```',
        '# patch',
        '```',
        'kBarFeature,',
        '```',
      ].join('\n');

const file = parseHatchFile(md); // <-- ВОТ функция: .md (строка) -> AST

console.log('language:', file.language ?? '(не указан)');
console.log('hunks:', file.hunks.length);
console.log(JSON.stringify(file, null, 2));

// демонстрация round-trip печати match-паттерна
console.log('\n--- printPattern(hunks[0].match) ---');
console.log(printPattern(file.hunks[0]!.match));