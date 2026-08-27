# match kt
    ...
        init {
    ...
    >>>
            require(size > 0) { "size must be positive" }
    <<<
    ...
    }
    ...
# end
# patch
    require(size in 1..4096) { "size must be positive" }
# end
