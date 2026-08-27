# match cc
    ...
    void f() {
    >>>
    		work();
    ...
    <<<
    }
    ...
# end
# patch

        work2();

# end
