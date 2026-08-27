// [DUP] три одинаковые функции в разных namespace, правка в средней
namespace a {
void Run() {
  Step();
}
}
namespace b {
void Run() {
  Step();
}
}
namespace c {
void Run() {
  Step();
}
}
