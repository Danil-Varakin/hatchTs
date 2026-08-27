// [SEALED] правка ветки when по sealed-иерархии
sealed class Result

fun describe(r: Result): String = when (r) {
    is Ok -> "ok"
    is Fail -> "failed: ${r.reason}"
    else -> "unknown"
}
