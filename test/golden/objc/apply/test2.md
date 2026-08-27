# match objc
    ...
    @implementation Downloader {
      NSInteger _inFlight;
    >>>
      NSString *_token;
    ...
# end
# patch

      NSDate *_startedAt;
# end
