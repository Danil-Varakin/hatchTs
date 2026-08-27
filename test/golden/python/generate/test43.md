# match py
    ...
    >>>
    Sink = Callable[ ..., None]
    <<<
    ...
# end
# patch
    Sink = Callable[ ..., bool]
# end
