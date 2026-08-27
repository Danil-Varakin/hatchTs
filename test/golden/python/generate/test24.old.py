# [STRUCT] правка в одной из веток case внутри match
def kind(payload):
    match payload:
        case {"kind": "leaf"}:
            return 1
        case {"kind": "node"}:
            return 1
        case _:
            return 0
