# match kotlin
    ...
        rows.forEach {
    ...
    >>>
            append(row.title)
    <<<
    ...
    }
    ...
# end
# patch
    append(row.caption)
# end
