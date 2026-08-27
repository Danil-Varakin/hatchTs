# match kotlin
    ...
    data class Setting(
        val key: String,
    ...
    >>>
        val secret: Boolean = false,
    <<<
    ...
# end
# patch
    val secret: Boolean = false,
        val ttl: Int = DEFAULT_TTL,
# end
