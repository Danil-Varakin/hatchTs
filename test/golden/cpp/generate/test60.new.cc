// [PP] `{` открыта в одной ветке #if, закрыта в другой — разбор поедет
void f() {
#if defined(A)
  if (x) {
#else
  if (y) {
#endif
    work2();
  }
}
