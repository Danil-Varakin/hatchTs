Замена аргументов ВТОРОГО декоратора: два `@retry` различаются только числами.

# match python
    ...
    >>>
        @retry(times=5, delay=2)
    <<<
    ...
        async def push(self, path, data):
    ...
# end
# patch
    @retry(times=8, delay=2)
# end
