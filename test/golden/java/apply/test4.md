# match java
    ...
        public void evictAll(Collection<? extends K> keys) {
    ...
    >>>
                store.remove(key);
    <<<
    ...
# end
# patch
    store.remove(key);
                onEvict(key);
# end
