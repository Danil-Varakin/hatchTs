# match c
    ...
    static struct ring make_ring( ... ) {
    ...
    >>>
      return (struct ring){ .capacity = capacity, .used = 0, .data = NULL };
    <<<
    ...
# end
# patch
    return (struct ring){ .capacity = capacity, .used = 0, .data = NULL, .head = {0} };
# end
