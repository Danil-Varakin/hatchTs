# match go
    ...
    	if err != nil {
    ...
    >>>
    		return nil, fmt.Errorf("read %s: %w", path, err)
    <<<
    ...
    }
    ...
# end
# patch
    return nil, fmt.Errorf("loading %s: %w", path, err)
# end
