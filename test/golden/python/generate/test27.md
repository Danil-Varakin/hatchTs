# match py
    ...
        return [
    ...
    >>>
            if a > 0
    <<<
    ...
    ]
    ...
# end
# patch
    if a >= 0
# end
