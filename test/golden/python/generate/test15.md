# match py
    ...
    def wrap(
    ...
    ):
    >>>
    ...
        if cond:
            step()
            more()
        return 1
    <<<
    ...
# end
# patch

      if cond:
        step()
        more()
      return 1
# end
