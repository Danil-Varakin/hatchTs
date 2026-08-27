// [TEXTBLOCK2] в текстовом блоке лежат ЗАГОЛОВКИ разметки Hatch и жёлоб в четыре пробела
static final String DOC = """
# match java
    void sample() {}
# end
# patch
""";

static String doc() {
    return DOC.strip();
}
