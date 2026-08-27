# match java
    ...
        public V get(K key, Function< ... > loader) {
    ...
    >>>
            V created = loader.apply(key);
    <<<
    ...
# end
# patch
    V created = Objects.requireNonNull(loader.apply(key));
# end
