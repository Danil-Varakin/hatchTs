# match m
    ...
    ^{
    ...
    >>>
        [self.delegate didFinish:self];
    <<<
    ...
    }
    ...
# end
# patch
    [self.delegate didFinishLoading:self];
# end
