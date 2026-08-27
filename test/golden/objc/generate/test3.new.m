// [IVAR] правка внутри ivar-блока { } у @implementation
@implementation Session {
  NSInteger _retries;
  NSString *_sessionToken;
}
- (void)reset {
  _retries = 0;
}
@end
