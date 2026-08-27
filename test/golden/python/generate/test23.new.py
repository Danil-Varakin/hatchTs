# [STRUCT] правка в ветке else конструкции try/except/else/finally
def load(path):
    try:
        data = read(path)
    except OSError:
        data = None
    else:
        data = data.rstrip()
    finally:
        close(path)
    return data
