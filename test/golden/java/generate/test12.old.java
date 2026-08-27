// [DEFAULTM] правка default-метода интерфейса между двумя абстрактными
interface Cache {
    byte[] get(String key);

    default boolean has(String key) {
        return get(key) != null;
    }

    void put(String key, byte[] value);
}
