# match py
    ...
        def bump():
    ...
    >>>
            total += 1
    <<<
    ...
    return bump
    ...
# end
# patch
    total += 2
# end
