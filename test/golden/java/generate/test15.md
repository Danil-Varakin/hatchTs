# match java
    ...
    >>>
    private final Map<String, List<Set<Integer>>> index = new HashMap<>();
    <<<
    ...
# end
# patch
    private final Map<String, List<Set<Long>>> index = new HashMap<>();
# end
