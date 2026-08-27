// [BRACKETGEN] дженерики Go — в КВАДРАТНЫХ скобках, `<` остаётся оператором
func Max[T int | float64 | string](a, b T) T {
	if a < b {
		return b
	}
	return a
}
