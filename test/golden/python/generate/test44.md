# match py
    ...
    def banner() -> str:
    ...
    >>>
        return "a" + "b"
    <<<
    ...
# end
# patch
    pad = "   "   
        return "a" + pad + "b"
# end
