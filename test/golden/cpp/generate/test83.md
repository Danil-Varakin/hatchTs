# match cpp
    ...
    void A() {
    ...
    >>>
      Step(1);
    <<<
    ...
    }
    ...
# end
# patch
    Step(2);
      Extra(1);
      Extra(2);
# end

# match cpp
    ...
    void B() {
    ...
    >>>
    }
    ...
# end
# patch
      More();

# end
