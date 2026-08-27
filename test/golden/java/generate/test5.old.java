// [INNER] правка в НЕстатическом внутреннем классе
public class Outer {
    private int base = 1;

    class Inner {
        int scaled() {
            return base * 10;
        }
    }
}
