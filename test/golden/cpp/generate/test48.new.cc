// [BRACE] функция обёрнута в новый #if — правка ДОБАВЛЯЕТ несбалансированный препроцессор
#if BUILDFLAG(IS_WIN)
void f() {
  work();
}
#else
void f() {
  other();
}
#endif
