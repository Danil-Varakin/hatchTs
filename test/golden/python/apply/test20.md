Две property одинаковой формы (width и height) — различает заголовок метода.

# match python
    ...
        def height(self) -> int:
    ...
    >>>
            return max(ys) - min(ys)
    <<<
    ...
# end
# patch
    return abs(max(ys) - min(ys))
# end
