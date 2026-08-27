# match kt
    ...
    >>>
        is Fail -> "failed: ${r.reason}"
    <<<
    ...
# end
# patch
    is Fail -> "error: ${r.reason}"
# end
