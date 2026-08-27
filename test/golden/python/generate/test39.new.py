# [SLICE] правка выражения со срезами и двоеточиями в скобках
def window(data):
    head = data[1:2]
    body = data[2:-1:4]
    return head + body
