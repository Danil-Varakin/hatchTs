// [RECEIVER] правка в методе с ресивером-указателем
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.count += 2
}
