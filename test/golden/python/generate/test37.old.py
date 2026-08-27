# [ANNOT] правка в аннотации внутри многострочной сигнатуры
def build(
    name: str,
    count: int = 0,
    tags: list[str] | None = None,
) -> Result:
    return Result(name, count, tags)
