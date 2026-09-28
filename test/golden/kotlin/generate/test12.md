# match kotlin
    ...
        map.forEach {
    ...
    >>>
            println("$key = $value")
    <<<
    ...
    }
    ...
# end
# patch
    println("$key -> $value")
# end
