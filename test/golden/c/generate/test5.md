# match c
    ...
    int legacy(
    ...
    )
        int a;
        int b;
    {
    ...
    >>>
      return a + b;
    <<<
    ...
    }
    ...
# end
# patch
    return a * b;
# end
