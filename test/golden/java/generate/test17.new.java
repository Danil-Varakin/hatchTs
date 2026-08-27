// [ANONDUP] два анонимных Comparator, различие ТОЛЬКО внутри скобок вызова
void order(List<Row> byWidth, List<Row> byHeight) {
    byWidth.sort(new Comparator<Row>() {
        @Override
        public int compare(Row a, Row b) {
            return Integer.compare(b.width, a.width);
        }
    });
    byHeight.sort(new Comparator<Row>() {
        @Override
        public int compare(Row a, Row b) {
            return Integer.compare(a.height, b.height);
        }
    });
}
