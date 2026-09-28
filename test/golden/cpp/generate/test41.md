# match cpp
    ...
    void f() {
    ...
      step();
      step();
      step();
      step();
    >>>
    ...
      step();
      step();
    ...
    }
    ...
# end
# patch

      step(5);
# end

# match cpp
    ...
    void f() {
    ...
      step(5);
      step();
    >>>
      step();
    ...
    <<<
    }
    ...
# end
# patch


# end
