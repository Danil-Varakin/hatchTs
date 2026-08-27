# match py
    ...
    def show(
    ...
    ):
    ...
    >>>
        return f"{user.name} ({user.age})"
    <<<
    ...
# end
# patch
    return f"{user.title} ({user.age})"
# end
