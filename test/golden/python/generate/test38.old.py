# [ANNOT] правка внутри блока if TYPE_CHECKING
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pkg.models import Node
    from pkg.models import Edge


def link(a, b):
    return (a, b)
