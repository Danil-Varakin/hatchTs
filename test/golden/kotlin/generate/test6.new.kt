// [COMPANION] правка внутри companion object
class Client private constructor(val host: String) {
    companion object {
        const val DEFAULT_PORT = 9090

        fun local() = Client("127.0.0.1")
    }
}
