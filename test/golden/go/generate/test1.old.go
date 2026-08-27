// [BRACKETGEN] дженерики Go — в КВАДРАТНЫХ скобках, `<` остаётся оператором
func Max[T int | float64](a, b T) T {
	if a < b {
		return b
	}
	return a
}
