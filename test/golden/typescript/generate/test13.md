# match ts
    ...
    >>>
    import type { Alpha, Beta, Gamma } from './types.ts';
    <<<
    ...
# end
# patch
    import type { Alpha, Beta as B2, Gamma } from './types.ts';
# end
