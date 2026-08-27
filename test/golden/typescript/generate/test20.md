# match ts
    ...
    >>>
    export const bucket = (hash: number): number => hash \>>> 24;
    <<<
    ...
# end
# patch
    export const bucket = (hash: number): number => hash >>> 20;
# end
