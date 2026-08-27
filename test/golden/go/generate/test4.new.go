// [CHAN] стрелка канала <- : не скобка и не сравнение
func pump(in <-chan int, done <-chan struct{}) {
	select {
	case v := <-in:
		handle(v * 2)
	case <-done:
		return
	}
}
