// [FALLTHROUGH] правка в ветке switch с fallthrough
func label(n int) string {
	switch {
	case n > 100:
		return "enormous"
	case n > 10:
		fallthrough
	case n > 0:
		return "positive"
	}
	return "zero"
}
