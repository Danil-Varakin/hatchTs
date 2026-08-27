# match c
    ...
    fail:
    ...
    >>>
      free(r->data);
    <<<
    ...
# end
# patch
    log_error("ring_init failed");
      free(r->data);
# end
