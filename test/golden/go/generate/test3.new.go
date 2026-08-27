// [DEFER] правка внутри defer, объявленного в цикле
func closeAll(paths []string) {
	for _, p := range paths {
		f, _ := os.Open(p)
		defer func() {
			_ = f.Close()
		}()
	}
}
