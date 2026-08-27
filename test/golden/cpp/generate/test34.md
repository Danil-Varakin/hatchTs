# match cc
    ...
    void f() {
    ...
    >>>
      const char* s = "hello  world";
    <<<
    ...
    }
    ...
# end
# patch
    const char* s = "hello world";
# end
