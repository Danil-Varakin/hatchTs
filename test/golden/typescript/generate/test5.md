# match ts
    ...
    >>>
    export function read(src: Buffer): string;
    <<<
    ...
# end
# patch
    export function read(src: Buffer, enc?: string): string;
# end
