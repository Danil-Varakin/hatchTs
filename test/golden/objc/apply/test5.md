# match objc
    ...
    @property(nonatomic, copy) NSString *endpoint;
    >>>
    @property(nonatomic, assign) NSInteger retries;
    ...
# end
# patch

    @property(nonatomic, assign) NSTimeInterval timeout;
# end
