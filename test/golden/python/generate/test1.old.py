# [INDENT] правка на третьем уровне вложенности (три вложенных for)
def scan(rows):
    for row in rows:
        for cell in row:
            for bit in cell:
                emit(bit)
