# match cc
    ...
    void f() {
    ...
    >>>
      int a = 1;
    <<<
    ...
    }
    ...
# end
# patch
    int a = 2;
# end
