# match cc
    ...
    >>>
    int a = 1;
    <<<
    ...
# end
# patch
    int a = 9;
# end

# match cc
    ...
    >>>
    int b = 2;
    <<<
    ...
# end
# patch
    int b = 8;
# end
