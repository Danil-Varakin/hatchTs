// [DATA] правка параметра в первичном конструкторе data class
data class User(
    val id: Long,
    val name: String,
    val active: Boolean = false,
)
