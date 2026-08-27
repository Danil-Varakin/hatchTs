# match cc
    ...
    void f() {
    >>>
      int a = 1;   
    ...
    <<<
      int b = 2;
    ...
    }
    ...
# end
# patch

      int a = 1;
      
# end
