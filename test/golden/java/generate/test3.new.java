// [ANNOT] правка в массиве-аргументе аннотации
@SuppressWarnings({"unchecked", "rawtypes", "deprecation"})
public void migrate(Map raw) {
    store.putAll(raw);
}
