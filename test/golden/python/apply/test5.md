Правка внутри comprehension: условие фильтра меняется, скобки не трогаем.

# match python
    ...
    def buckets(rows):
    ...
    >>>
            if key not in {"skip", "drop"}
    <<<
    ...
            if value is not None
    ...
# end
# patch
    if key not in {"skip", "drop", "hold"}
# end
