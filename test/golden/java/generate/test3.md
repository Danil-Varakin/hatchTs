# match java
    ...
    >>>
    @SuppressWarnings({"unchecked", "rawtypes"})
    <<<
    ...
# end
# patch
    @SuppressWarnings({"unchecked", "rawtypes", "deprecation"})
# end
