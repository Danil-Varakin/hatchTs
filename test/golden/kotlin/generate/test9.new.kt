// [INIT] правка внутри init-блока между свойствами
class Buffer(size: Int) {
    private val data = ByteArray(size)

    init {
        require(size in 1..4096) { "size must be positive" }
    }

    val capacity get() = data.size
}
