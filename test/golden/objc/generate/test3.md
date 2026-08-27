# match m
    ...
    @implementation Session {
    ...
    >>>
      NSString *_token;
    <<<
    ...
    }
    ...
# end
# patch
    NSString *_sessionToken;
# end
