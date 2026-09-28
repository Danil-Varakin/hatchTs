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

      work(2);

# end
