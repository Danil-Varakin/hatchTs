# match c
    ...
    size_t ring_push( ... ) {
    ...
    >>>
      memcpy(r->data + r->used, src, n);
    <<<
    ...
# end
# patch
    memmove(r->data + r->used, src, n);
# end
