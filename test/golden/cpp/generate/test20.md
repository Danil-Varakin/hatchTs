# match cpp
    ...
    void Send(int a, int b) {
    ...
    >>>
      Impl(a);
    <<<
    ...
    }
    ...
# end
# patch
    Impl(a, b);
# end
