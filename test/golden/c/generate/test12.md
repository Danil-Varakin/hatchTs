# match c
    ...
    >>>
          fprintf(stderr, msg); \
    <<<
    ...
# end
# patch
    fprintf(stdout, msg); \
# end
