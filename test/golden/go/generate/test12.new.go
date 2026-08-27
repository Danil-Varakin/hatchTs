// [TYPESWITCH] правка ветки switch v := x.(type)
func describe(x any) string {
	switch v := x.(type) {
	case int:
		return strconv.FormatInt(int64(v), 10)
	case string:
		return v
	default:
		return "?"
	}
}
