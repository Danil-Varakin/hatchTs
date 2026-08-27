# match java
    ...
        for (Number n : values) {
    ...
    >>>
            sum += n.doubleValue();
    <<<
    ...
    }
    ...
# end
# patch
    sum += n.doubleValue() * 2;
# end
