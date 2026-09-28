# match cpp
    ...
    void f() {
    ...
      work();
    >>>
      work();
    ...
    <<<
      work();
    ...
    }
    ...
# end
# patch


      work(2);

      
# end
