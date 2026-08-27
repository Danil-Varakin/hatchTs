// [SAFECALL] правка в цепочке ?.let { } ?: с элвисом
fun titleOf(node: Node?): String {
    return node?.header?.let { it.text.trim() } ?: "untitled"
}
