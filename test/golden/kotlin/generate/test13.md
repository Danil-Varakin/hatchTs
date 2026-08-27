# match kt
    ...
    >>>
        matches(cmd, "push") -> handle(cmd.payload, retries(1))
    <<<
    ...
# end
# patch
    matches(cmd, "push") -> handle(cmd.payload, retries(3))
# end
