Замена заголовка функции с обобщением списка аргументов по скобкам: `...` внутри
`( )` переживает любую правку сигнатуры.

# match python
    ...
    >>>
    def flatten( ... ):
    <<<
    ...
        out = []
    ...
# end
# patch
    def flatten(rows, strict=False, prefix="", limit=None):
# end
