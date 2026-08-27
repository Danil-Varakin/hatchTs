# match java
    ...
            @Override
            public int compare(
    ...
    ) {
    ...
    >>>
                return Integer.compare(a.width, b.width);
    <<<
    ...
    }
    ...
# end
# patch
    return Integer.compare(b.width, a.width);
# end
