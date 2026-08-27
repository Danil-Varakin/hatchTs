# match go
    ...
    >>>
    func Max[T int | float64](a, b T) T {
    <<<
    ...
# end
# patch
    func Max[T int | float64 | string](a, b T) T {
# end
