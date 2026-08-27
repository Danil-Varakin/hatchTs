# match py
    ...
    def outer():
    ...
    >>>
        @retry(times=3, delay=1)
    <<<
    ...
# end
# patch
    @retry(times=5, delay=1)
# end
