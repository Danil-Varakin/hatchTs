# match go
    ...
    type Job interface {
    	Run(ctx context.Context) error
    ...
    >>>
    	Name() string
    <<<
    ...
# end
# patch
    Name() string
    	Timeout() time.Duration
# end
