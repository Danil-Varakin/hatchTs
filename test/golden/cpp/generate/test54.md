# match cc
    ...
    void f() {
    ...
      // int a = 1;
    >>>
      int a = 1;
    ...
    <<<
      use(
    ...
    );
    ...
    }
    ...
# end
# patch

      int a = 2;
      
# end
