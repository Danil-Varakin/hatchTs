Рядом с правкой стоит настоящий питоновский `...` (Ellipsis) — в паттерне он
обязан быть экранирован как `\...`, иначе это оператор пропуска.

# match python
    ...
    def stub(*args, **kwargs):
    ...
        \...
    ...
    >>>
        return None
    <<<
    ...
# end
# patch
    return False
# end
