# [ELLIPSISANN] Ellipsis как ТИП: Callable[ ..., None] — оператор Hatch отдельным словом
from typing import Callable

Sink = Callable[ ..., bool]


def wire(sink: Sink) -> None:
    sink(1)
