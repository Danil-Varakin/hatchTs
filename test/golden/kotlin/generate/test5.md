# match kt
    ...
    fun String.squeeze(): String {
    ...
    >>>
        return trim().replace(Regex("\s+"), " ")
    <<<
    ...
    }
    ...
# end
# patch
    return trim().replace(Regex("\s+"), "_")
# end
