// [COMPANION] правка внутри companion object
class Client private constructor(val host: String) {
    companion object {
        const val DEFAULT_PORT = 8080

        fun local() = Client("127.0.0.1")
    }
}
