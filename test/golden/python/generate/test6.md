# match python
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
