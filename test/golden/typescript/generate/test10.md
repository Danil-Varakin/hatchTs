# match ts
    ...
    >>>
    const typed = raw as unknown as Record<string, number>;
    <<<
    ...
# end
# patch
    const typed = raw as unknown as Record<string, bigint>;
# end
