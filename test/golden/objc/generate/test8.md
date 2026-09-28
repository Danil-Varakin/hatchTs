# match objc
    ...
    @catch (NSException *e) {
    ...
    >>>
        [self report:e];
    <<<
    ...
    }
    ...
# end
# patch
    [self reportFatal:e];
# end
