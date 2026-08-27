# match c
    ...
    int ring_compare( ... ) {
    ...
      if (x->used < y->used) return -1;
    >>>
      if (x->used > y->used) return 1;
    ...
# end
# patch

      if (x->capacity != y->capacity) return 2;
# end
