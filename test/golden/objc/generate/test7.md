# match m
    ...
    >>>
    @property(nonatomic, assign) NSInteger count;
    <<<
    ...
# end
# patch
    @property(nonatomic, readonly) NSInteger count;
# end
