// [WRAPDUP] две обёртки ошибки, различитель — только строка ВНУТРИ скобок
func stageA() error {
	if err := step(); err != nil {
		return fmt.Errorf("stage a failed: %w", err)
	}
	return nil
}

func stageB() error {
	if err := step(); err != nil {
		return fmt.Errorf("step b: %w", err)
	}
	return nil
}
