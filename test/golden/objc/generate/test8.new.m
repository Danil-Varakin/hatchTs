// [TRY] правка в @catch между @try и @finally
- (void)run {
  @try {
    [self step];
  } @catch (NSException *e) {
    [self reportFatal:e];
  } @finally {
    [self close];
  }
}
