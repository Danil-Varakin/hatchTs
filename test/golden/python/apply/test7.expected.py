"""Модели предметной области."""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pkg.storage import Backend
    from pkg.storage import Index


@dataclass(frozen=True)
class Point:
    x: int = 0
    y: int = 0

    def shifted(self, dx: int, dy: int) -> "Point":
        return Point(self.x + dx, self.y + dy)


@dataclass
class Shape:
    name: str
    points: list[Point] = field(default_factory=list)
    tags: dict[str, str] = field(default_factory=dict)
    closed: bool = False

    def __post_init__(self) -> None:
        if not self.points:
            self.points = [Point()]
        if self.closed and self.points[0] != self.points[-1]:
            self.points.append(self.points[0])

    @property
    def width(self) -> int:
        xs = [p.x for p in self.points]
        return max(xs) - min(xs)

    @property
    def height(self) -> int:
        ys = [p.y for p in self.points]
        return max(ys) - min(ys)

    def scaled(
        self,
        factor: int,
        origin: "Point | tuple[int, int] | None" = None,
        keep_tags: bool = True,
    ) -> "Shape":
        base = origin or Point()
        moved = [Point(base.x + p.x * factor, base.y + p.y * factor) for p in self.points]
        return Shape(self.name, moved, dict(self.tags) if keep_tags else {})
