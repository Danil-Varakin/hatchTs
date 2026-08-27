# match kotlin
    ...
        fun load(key: String): Result = when {
    ...
    >>>
            key in cache -> Result.Ok(cache.getValue(key).value)
    <<<
    ...
# end
# patch
    key in cache -> Result.Ok(cache.getValue(key).value.trim())
# end
