// [INFIX] правка в инфиксной функции (вызов без точки и скобок)
infix fun Int.upTo(other: Int): IntRange {
    return this..other
}

val span = 1 upTo 10
