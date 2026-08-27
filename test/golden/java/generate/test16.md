# match java
    ...
    static String doc() {
    ...
    >>>
        return DOC.strip();
    <<<
    ...
    }
    ...
# end
# patch
    return DOC.stripLeading();
# end
