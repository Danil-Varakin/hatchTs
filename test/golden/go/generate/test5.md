# match go
    ...
    Options{
    ...
    >>>
    	Timeout: 5 * time.Second,
    <<<
    ...
    }
    ...
# end
# patch
    Timeout: 30 * time.Second,
# end
