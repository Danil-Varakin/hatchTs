# match py
    ...
            if x:
    ...
    >>>
                handle(x)
    <<<
    ...
    return done
    ...
# end
# patch
    handle(x, force=True)
# end
