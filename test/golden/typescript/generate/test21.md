# match ts
    ...
    >>>
    export function load(input: Reader<Uint8Array>): void;
    <<<
    ...
# end
# patch
    export function load(input: Reader<Uint8Array | null>): void;
# end
