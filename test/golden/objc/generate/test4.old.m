// [BLOCK] правка внутри блока ^{ } переданного аргументом
- (void)load {
  [self fetch:^(NSData *data, NSError *error) {
    [self handle:data];
  }];
}
