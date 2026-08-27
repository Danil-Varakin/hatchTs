# [BRACKET] f-string с вложенными {} и вызовом внутри
def show(user):
    head = f"{user.name}"
    return f"{head}: {len(user.items) - 1} шт."
