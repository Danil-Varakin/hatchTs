# match cpp
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
