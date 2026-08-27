# match cc
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

# match cc
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
