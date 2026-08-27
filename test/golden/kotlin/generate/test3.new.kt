// [WHEN] правка в ветке when с диапазоном и стрелкой
fun grade(score: Int): String = when (score) {
    in 90..100 -> "A"
    in 70..89 -> "B"
    else -> "F"
}
