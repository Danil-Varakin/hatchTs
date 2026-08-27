# match java
    ...
        static {
    ...
    >>>
            LIMITS.put("default", 1024);
    <<<
    ...
# end
# patch
    LIMITS.put("default", 2048);
# end
