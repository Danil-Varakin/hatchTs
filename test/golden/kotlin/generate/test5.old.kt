// [EXTFUN] правка в функции-расширении (получатель в имени)
fun String.squeeze(): String {
    return trim().replace(Regex("\s+"), " ")
}
