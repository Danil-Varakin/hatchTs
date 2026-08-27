# match cc
    ...
    void f() {
    ...
      a();
    >>>
      // лишний комментарий
    ...
    <<<
      b();
    ...
    }
    ...
# end
# patch

      
# end
