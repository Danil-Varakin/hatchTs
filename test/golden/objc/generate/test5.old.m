// [SELECTOR] правка внутри @selector(a:b:) — двоеточия не блок
- (void)wire {
  [button addTarget:self action:@selector(tap:withEvent:) forControlEvents:UIControlEventTouchUpInside];
}
