# match go
    ...
    		go func(j T) {
    ...
    >>>
    			done <- j.Run(ctx)
    <<<
    ...
# end
# patch
    done <- j.Run(ctx)
    			_ = j.Name()
# end
