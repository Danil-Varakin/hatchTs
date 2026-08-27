# match py
    ...
    def window(
    ...
    ):
    ...
    >>>
        body = data[2:-1:3]
    <<<
    ...
# end
# patch
    body = data[2:-1:4]
# end
