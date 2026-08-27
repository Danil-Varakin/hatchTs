// [DEFAULTM] правка default-метода интерфейса между двумя абстрактными
interface Cache {
    byte[] get(String key);

    default boolean has(String key) {
        return get(key) != null && get(key).length > 0;
    }

    void put(String key, byte[] value);
}
