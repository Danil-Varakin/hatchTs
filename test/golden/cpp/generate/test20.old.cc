// [DUP] перегрузки с одинаковым именем и разной сигнатурой
void Send(int a) {
  Impl(a);
}
void Send(int a, int b) {
  Impl(a);
}
void Send(int a, int b, int c) {
  Impl(a);
}
