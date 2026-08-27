# match go
    ...
    	switch v := x.(type) {
    ...
    >>>
    		return fmt.Sprintf("state %d", int(v))
    <<<
    ...
# end
# patch
    return fmt.Sprintf("state=%d", int(v))
# end
