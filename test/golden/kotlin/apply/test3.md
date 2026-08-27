# match kotlin
    ...
        companion object {
    ...
    >>>
            const val DEFAULT_TTL = 300
    <<<
    ...
# end
# patch
    const val DEFAULT_TTL = 600
# end
