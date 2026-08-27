# match go
    ...
    func banner() string {
    ...
    >>>
    	return "value with spaces"
    <<<
    ...
# end
# patch
    return "value with gaps"
# end
