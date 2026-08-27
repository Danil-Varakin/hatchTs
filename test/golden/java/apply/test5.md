# match java
    ...
            return new Runnable() {
    ...
    >>>
                    store.clear();
    <<<
    ...
# end
# patch
    store.clear();
                    LIMITS.clear();
# end
