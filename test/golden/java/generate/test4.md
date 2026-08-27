# match java
    ...
        static {
    ...
    >>>
            LIMITS.put("default", 10);
    <<<
    ...
    }
    ...
# end
# patch
    LIMITS.put("default", 25);
# end
