# [STRUCT] правка внутри with — заголовок блока без имени
def save(path, data):
    with open(path, "w") as fh:
        fh.write(data)
        fh.flush()
    return path
