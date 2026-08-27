# match ts
    ...
    module 'legacy' {
    ...
    >>>
      export const flag: boolean;
    <<<
    ...
    }
    ...
# end
# patch
    export const flag: 0 | 1;
# end
