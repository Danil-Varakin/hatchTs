# match rs
    ...
    || {
    ...
    >>>
                                run(|| 1)
    <<<
    ...
    }
    ...
# end
# patch
    run(|| 7)
# end
