// [ENUMBODY] правка в константе enum, у которой СВОЁ тело
enum Op {
    PLUS("+") {
        int apply(int a, int b) {
            return Math.addExact(a, b);
        }
    },
    MINUS("-") {
        int apply(int a, int b) {
            return a - b;
        }
    };

    Op(String sign) {}
}
