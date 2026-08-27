// [STRUCT] два ИДЕНТИЧНЫХ if-блока в одной функции, правка во втором
void f() {
  if (cond) {
    a();
    b();
    c();
    work();
  }
  if (cond) {
    a();
    b();
    c();
    work(2);
  }
}
