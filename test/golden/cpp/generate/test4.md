# match cc
    ...
    >>>
        char var_name[char_count];                                 \
    <<<
    ...
# end
# patch
    char var_name[char_count + 1];                             \
# end
