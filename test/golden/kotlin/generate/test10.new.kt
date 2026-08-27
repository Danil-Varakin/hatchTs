// [SEALED] правка ветки when по sealed-иерархии
sealed class Result

fun describe(r: Result): String = when (r) {
    is Ok -> "ok"
    is Fail -> "error: ${r.reason}"
    else -> "unknown"
}
