// [TRAILING] правка внутри трейлинг-лямбды (блок ЗА скобками вызова)
fun render(rows: List<Row>) = buildString {
    rows.forEach { row ->
        append(row.caption)
    }
}
