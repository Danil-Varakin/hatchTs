// [TYPESWITCH] правка ветки switch v := x.(type)
func describe(x any) string {
	switch v := x.(type) {
	case int:
		return strconv.Itoa(v)
	case string:
		return v
	default:
		return "?"
	}
}
