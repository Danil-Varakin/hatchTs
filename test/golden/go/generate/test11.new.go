// [GOROUTINE] правка внутри горутины go func(){}()
func spawn(jobs []Job) {
	for _, j := range jobs {
		go func(j Job) {
			j.RunWithRetry()
		}(j)
	}
}
