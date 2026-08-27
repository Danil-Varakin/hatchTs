// [STATICINIT] правка внутри статического инициализатора static { }
class Registry {
    static final Map<String, Integer> LIMITS = new HashMap<>();

    static {
        LIMITS.put("default", 25);
        LIMITS.put("burst", 100);
    }
}
