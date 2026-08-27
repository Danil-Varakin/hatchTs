# [SCOPE] правка рядом с nonlocal во вложенной функции
def counter():
    total = 0

    def bump():
        nonlocal total
        total += 1
        return total

    return bump
