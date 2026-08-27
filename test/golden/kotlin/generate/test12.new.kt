// [DESTRUCT] правка внутри лямбды с деструктуризацией (a, b) ->
fun dump(map: Map<String, Int>) {
    map.forEach { (key, value) ->
        println("$key -> $value")
    }
}
