// [MULTIRET] правка во втором из нескольких возвращаемых значений
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("loading %s: %w", path, err)
	}
	return parse(data)
}
