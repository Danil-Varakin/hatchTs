# match py
    ...
    def build(
    ...
    >>>
        tags: list[str] | None = None,
    <<<
    ...
    )
    ...
# end
# patch
    tags: tuple[str, ...] | None = None,
# end
