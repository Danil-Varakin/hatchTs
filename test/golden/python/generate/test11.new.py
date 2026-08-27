# [BRACKET] словарь-литерал в аргументе по умолчанию
def build(opts={"retry": 3, "delay": 10}):
    return dict(opts)
