# match java
    ...
        case MEDIUM -> {
    ...
    >>>
            yield 5;
    <<<
    ...
    }
    ...
# end
# patch
    yield 7;
# end
