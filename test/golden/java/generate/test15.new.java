// [ANGLES] тройное закрытие дженериков даёт токен `>>>` внутри правящейся строки
private final Map<String, List<Set<Long>>> index = new HashMap<>();

void seed(String key) {
    index.computeIfAbsent(key, k -> new ArrayList<>());
}
