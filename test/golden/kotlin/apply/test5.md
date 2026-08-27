# match kotlin
    ...
        init {
    ...
    >>>
            require(source.isNotEmpty()) { "source must not be empty" }
    <<<
    ...
# end
# patch
    require(source.isNotEmpty()) { "settings source must not be empty" }
# end
