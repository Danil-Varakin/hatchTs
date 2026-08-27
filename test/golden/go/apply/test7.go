// [ZONE] MUST-REFUSE: в файле строка с ШИРОКИМИ внутренними пробелами, а инструкция
// написана с обычными. Пробел внутри строкового литерала — ДАННЫЕ: якорь обязан не лечь.
package fmtdemo

func banner() string {
	return "value  with   spaces"
}
