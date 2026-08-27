# match py
    ...
        async with session() as s:
    ...
    >>>
            async for chunk in s.get(url):
    <<<
    ...
# end
# patch
    async for chunk in s.get(url, timeout=5):
# end
