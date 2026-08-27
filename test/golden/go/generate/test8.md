# match go
    ...
    >>>
    	Put(key string, value []byte) error
    <<<
    ...
# end
# patch
    Put(key string, value []byte, ttl time.Duration) error
# end
