# match m
    ...
    // [SELECTOR] правка внутри @selector(a:b:) — двоеточия не блок
    - (void)wire {
    ...
    >>>
      [button addTarget:self action:@selector(tap:withEvent:) forControlEvents:UIControlEventTouchUpInside];
    <<<
    ...
    }
    ...
# end
# patch
    [button addTarget:self action:@selector(press:withEvent:) forControlEvents:UIControlEventTouchUpInside];
# end
