// [WILDCARD] правка внутри маски дженерика <? extends T>
static double total(List<? extends Number> values) {
    double sum = 0;
    for (Number n : values) {
        sum += n.doubleValue();
    }
    return sum;
}
