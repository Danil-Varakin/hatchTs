# match c
    ...
      for (int i = 0; i < n; i++) {
    ...
    >>>
        buf[i] = factor;
    <<<
    ...
    }
    ...
# end
# patch
    buf[i] = factor * i;
# end
