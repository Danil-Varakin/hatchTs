Замена ветки case внутри match: якорем служит соседняя ветка сверху.

# match python
    ...
    def classify(payload):
    ...
            case {"kind": "node", "children": [*rest]}:
    ...
    >>>
                return "node"
    <<<
    ...
            case [first, *_] if isinstance(first, str):
    ...
# end
# patch
    return "branch"
# end
