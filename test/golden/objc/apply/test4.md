# match objc
    ...
      @try {
    ...
    >>>
        [self report:e];
    <<<
    ...
# end
# patch
    [self reportFatal:e];
# end
