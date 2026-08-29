"""Разбор входящих сообщений в плоские записи."""

LIMITS = {
    "net": {
        "retry": {
            "count": 3,
            "delay": 5,
        },
        "timeout": 30,
    },
    "disk": {
        "retry": {
            "count": 1,
            "delay": 15,
        },
        "timeout": 60,
    },
}


def classify(payload):
    match payload:
        case {"kind": "leaf", "weight": int(weight)} if weight > 0:
            return "leaf"
        case {"kind": "node", "children": [*rest]}:
            return "node"
        case [first, *_] if isinstance(first, str):
            return "sequence"
        case _:
            return "unknown"


def flatten(rows, strict=False, prefix=""):
    out = []
    for row in rows:
        if not row:
            continue
        for key, value in row.items():
            if strict and value is None:
                raise ValueError(key)
            out.append((prefix + key, value))
    return out


def buckets(rows):
    return [
        (key, value)
        for key, value in rows
        if key not in {"skip", "drop"}
        if value is not None
    ]


def summarize(rows):
    total = 0
    for key, value in rows:
        if isinstance(value, int):
            total += value
        elif isinstance(value, list):
            total += len(value)
        else:
            total += 1
    return total
