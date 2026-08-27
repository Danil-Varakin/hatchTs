# match c
    ...
    struct Flags {
    ...
    >>>
      unsigned int level : 3;
    <<<
    ...
    }
    ...
# end
# patch
    unsigned int level : 2;
# end
