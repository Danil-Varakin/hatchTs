// [ENUMDUP] две константы enum с ОДИНАКОВЫМ телом, различитель — только имя константы
enum Mode {
    FAST {
        int cost() {
            return base(1);
        }
    },
    SLOW {
        int cost() {
            return base(1);
        }
    };

    abstract int cost();

    static int base(int k) {
        return k;
    }
}
