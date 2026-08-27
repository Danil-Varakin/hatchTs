# match py
    ...
    def a(
    ...
    ):
    >>>
    ...
    	if cond:
    		step()
    	return 0
    <<<
    ...
# end
# patch

        if cond:
            step()
        return 0
# end
