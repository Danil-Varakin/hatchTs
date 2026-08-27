# match java
    ...
            int scaled() {
    ...
    >>>
                return base * 10;
    <<<
    ...
    }
    ...
# end
# patch
    return base * 100;
# end
