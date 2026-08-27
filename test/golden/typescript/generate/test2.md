# match ts
    ...
    >>>
    const cache: Map<string, Array<Promise<number>>> = new Map();
    <<<
    ...
# end
# patch
    const cache: Map<string, Array<Promise<bigint>>> = new Map();
# end
