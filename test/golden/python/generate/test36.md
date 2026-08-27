# match py
    ...
    class Api:
    ...
    >>>
        @cached(ttl=60)
    <<<
    ...
# end
# patch
    @cached(ttl=120)
# end
