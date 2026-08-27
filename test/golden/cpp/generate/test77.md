# match cc
    ...
    void f() {
    ...
    >>>
      base::BindOnce([](int x) { work(x); }, 2);
    <<<
    ...
    }
    ...
# end
# patch
    base::BindOnce([](int x) { work2(x); }, 2);
# end
