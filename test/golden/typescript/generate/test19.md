# match ts
    ...
    >>>
    const index: Map<string, Array<Set<number>>> = new Map();
    <<<
    ...
# end
# patch
    const index: Map<string, Array<Set<bigint>>> = new Map();
# end
