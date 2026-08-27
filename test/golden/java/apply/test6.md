# match java
    ...
        public List<String> names() {
    ...
    >>>
                    .map(Object::toString)
    <<<
    ...
# end
# patch
    .map(Object::toString)
                    .filter(s -> !s.isEmpty())
# end
