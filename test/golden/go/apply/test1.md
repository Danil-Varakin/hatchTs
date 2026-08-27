# match go
    ...
    const (
    	StateIdle State = iota
    ...
    >>>
    	StateBusy
    <<<
    ...
# end
# patch
    StateBusy
    	StateStalled
# end
