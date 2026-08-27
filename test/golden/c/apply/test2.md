# match c
    ...
    struct header {
    ...
    >>>
      unsigned int level : 3;
    <<<
    ...
# end
# patch
    unsigned int level : 5;
# end
