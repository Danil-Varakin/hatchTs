"""Мелкие утилиты: строки, шаблоны, заглушки протокола."""

import re

NUMBER = r"\d+\.\d+"
WORD = r"[A-Za-z_]\w*"


class Protocol:
    def read(self) -> bytes: ...
    def write(self, data: bytes) -> None: ...
    def close(self) -> None: ...


def add(a, b):
    """Складывает два числа.

    >>> add(1, 2)
    3
    >>> add(-1, 1)
    0
    """
    return a + b


def slug(text):
    """Приводит строку к виду, годному для адреса.

    Пример:

    ```python
    slug("Привет мир")
    ```
    """
    lowered = text.strip().lower()
    cleaned = re.sub(r"[^\w]+", "-", lowered)
    return cleaned.strip("-")


def numbers(text):
    found = re.findall(NUMBER, text)
    return [float(item) for item in found]


def stub(*args, **kwargs):
    ...
    return False
