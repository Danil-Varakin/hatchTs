# [SCOPE] правка рядом с nonlocal во вложенной функции
def counter():
    total = 0

    def bump():
        nonlocal total
        total += 2
        return total

    return bump
