"""Асинхронный клиент с повторами."""

import asyncio
from contextlib import suppress


def retry(times=3, delay=1):
    def decorator(fn):
        async def wrapper(*args, **kwargs):
            attempt = 0
            while attempt < times:
                try:
                    return await fn(*args, **kwargs)
                except TimeoutError:
                    attempt += 1
                    await asyncio.sleep(delay)
            raise TimeoutError(fn.__name__)
        return wrapper
    return decorator


class Client:
    def __init__(self, session, base):
        self.session = session
        self.base = base

    @retry(times=3, delay=1)
    async def fetch(self, path):
        async with self.session.get(self.base + path) as response:
            if response.status >= 500:
                raise TimeoutError(path)
            body = await response.read()
            return body.decode("utf-8")

    @retry(times=8, delay=2)
    async def push(self, path, data):
        async with self.session.post(self.base + path, data=data) as response:
            if response.status >= 500:
                raise TimeoutError(path)
            return response.status

    async def drain(self, paths):
        results = []
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(self.fetch(p)) for p in paths]
        for task in tasks:
            with suppress(asyncio.CancelledError):
                results.append(task.result())
        return results
