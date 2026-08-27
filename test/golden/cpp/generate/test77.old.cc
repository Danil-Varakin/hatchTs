// [NEST] правка внутри лямбды в вызове — обобщение скобок съедает тело
void f() {
  base::BindOnce([](int x) { work(x); }, 1);
  base::BindOnce([](int x) { work(x); }, 2);
}
