# match go
    ...
    func() {
    ...
    >>>
    			f.Close()
    <<<
    ...
    }
    ...
# end
# patch
    _ = f.Close()
# end
