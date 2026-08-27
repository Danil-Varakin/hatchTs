// [STRCANON] два элемента различаются ТОЛЬКО внутренними пробелами строки —
// канон схлопывает пробел между словесными символами и делает их НЕОТЛИЧИМЫМИ
func forms() []string {
	return []string{
		"value with gaps",
		"value  with   spaces",
	}
}
