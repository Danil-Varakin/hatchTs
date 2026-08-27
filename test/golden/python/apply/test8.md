Замена значения по умолчанию у поля dataclass.

# match python
    ...
    class Shape:
    ...
        name: str
    ...
    >>>
        closed: bool = False
    <<<
    ...
        def __post_init__(self) -> None:
    ...
# end
# patch
    closed: bool = True
# end
