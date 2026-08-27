# match rs
    ...
        match n {
    ...
    >>>
            1 | 2 | 3 => "small",
    <<<
    ...
    }
    ...
# end
# patch
    1 | 2 | 3 | 5 => "small",
# end
