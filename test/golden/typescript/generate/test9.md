# match ts
    ...
    namespace inner {
    ...
    >>>
        export const version = 1;
    <<<
    ...
    }
    ...
# end
# patch
    export const version = 2;
# end
