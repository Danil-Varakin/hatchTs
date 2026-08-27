# match kt
    ...
    data class User(
    ...
    >>>
        val active: Boolean = true,
    <<<
    ...
    )
    ...
# end
# patch
    val active: Boolean = false,
# end
