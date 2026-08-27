# match go
    ...
    	if err := step(); err != nil {
    ...
    >>>
    		return fmt.Errorf("step a: %w", err)
    <<<
    ...
    }
    ...
# end
# patch
    return fmt.Errorf("stage a failed: %w", err)
# end
