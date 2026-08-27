Правка аннотации в многострочной сигнатуре.

# match python
    ...
    class Shape:
    ...
        def scaled(
    ...
    >>>
            origin: Point | None = None,
    <<<
    ...
            keep_tags: bool = True,
    ...
# end
# patch
    origin: "Point | tuple[int, int] | None" = None,
# end
