# match cpp
    ...
    >>>
    int a = 1;
    <<<
    ...
# end
# patch
    int a = 9;
# end

# match cpp
    ...
    >>>
    int b = 2;
    <<<
    ...
# end
# patch
    int b = 8;
# end
