# match c
    ...
    *const kNames[] = {
    ...
    >>>
        [3] = "three",
    <<<
    ...
    }
    ...
# end
# patch
    [3] = "trois",
# end
