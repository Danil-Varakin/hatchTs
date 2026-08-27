# match c
    ...
    >>>
    typedef int (*compare_fn)(const void *a, const void *b);
    <<<
    ...
# end
# patch
    typedef int (*compare_fn)(const void *a, const void *b, void *ctx);
# end
