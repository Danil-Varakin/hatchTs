// [INIT] правка внутри init-блока между свойствами
class Buffer(size: Int) {
    private val data = ByteArray(size)

    init {
        require(size > 0) { "size must be positive" }
    }

    val capacity get() = data.size
}
