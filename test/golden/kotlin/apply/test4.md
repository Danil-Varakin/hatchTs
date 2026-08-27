# match kotlin
    ...
        fun warm(keys: List<String>) {
    ...
    >>>
                    cache[key] = Setting(key, raw.trim())
    <<<
    ...
# end
# patch
    cache[key] = Setting(key, raw.squeeze())
# end
