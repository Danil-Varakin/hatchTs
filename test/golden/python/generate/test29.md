# match py
    ...
    def a(
    ...
    ):
    >>>
    ...
    <<<
        return 0
    ...
# end
# patch

        if cond:
            step()
            step()
        
# end
