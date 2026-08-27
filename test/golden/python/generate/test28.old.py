# [NEST] декоратор с аргументами над ВЛОЖЕННОЙ функцией
def outer():
    @retry(times=3, delay=1)
    def inner():
        return work()

    return inner()
