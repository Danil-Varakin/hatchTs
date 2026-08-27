# match objc
    ...
    - (void)wire:(UIButton *)button {
    ...
    >>>
      [button addTarget:self action:@selector(tap:withEvent:) forControlEvents:UIControlEventTouchUpInside];
    <<<
    ...
# end
# patch
    [button addTarget:self action:@selector(press:withEvent:) forControlEvents:UIControlEventTouchUpInside];
# end
