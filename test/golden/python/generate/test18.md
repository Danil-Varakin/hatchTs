# match py
    ...
    def loop(
    ...
    ):
    ...
    >>>
        return len(items)
    <<<
    ...
# end
# patch
    return len(items) + 1
# end
