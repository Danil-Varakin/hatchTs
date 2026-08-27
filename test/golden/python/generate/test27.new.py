# [NEST] правка внутри вложенного comprehension
def pairs(rows):
    return [
        (a, b)
        for row in rows
        for a, b in row
        if a >= 0
    ]
