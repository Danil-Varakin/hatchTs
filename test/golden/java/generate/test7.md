# match java
    ...
    >>>
         OutputStream out = create(dest)) {
    <<<
    ...
# end
# patch
    OutputStream out = create(dest, true)) {
# end
