# match cc
    ...
    void f() {
    ...
    >>>
      int a = 1;
      int b = 2;
      int c = 3;
    <<<
    ...
    }
    ...
# end
# patch
      int a = 1;
        int b = 2;
        int c = 3;
# end
