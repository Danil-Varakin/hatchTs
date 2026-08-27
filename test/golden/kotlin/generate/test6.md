# match kt
    ...
        companion object {
    ...
    >>>
            const val DEFAULT_PORT = 8080
    <<<
    ...
    }
    ...
# end
# patch
    const val DEFAULT_PORT = 9090
# end
