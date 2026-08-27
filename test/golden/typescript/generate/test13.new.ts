// [TYPEONLY] правка в списке type-only импорта
import type { Alpha, Beta as B2, Gamma } from './types.ts';
import { run } from './run.ts';

export const all: [Alpha, Beta, Gamma] = run();
