# [ASYNC] правка внутри async with внутри async def
async def fetch(url):
    async with session() as s:
        async for chunk in s.get(url, timeout=5):
            yield chunk
