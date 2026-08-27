// [DISPATCH] правка внутри блока, переданного в dispatch_async
- (void)commit {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.delegate didFinish:self];
  });
}
