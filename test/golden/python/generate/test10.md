# match python
    ...
    def show(
    ...
    ):
    ...
    >>>
        return f"{head}: {len(user.items)} шт."
    <<<
    ...
# end
# patch
    return f"{head}: {len(user.items) - 1} шт."
# end
