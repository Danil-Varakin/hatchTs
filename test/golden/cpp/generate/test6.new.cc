// [BRACE] `{` открыта внутри #if, закрыта снаружи — текстовый баланс не сходится
void Run() {
#if BUILDFLAG(IS_WIN)
  if (IsWin()) {
#else
  if (IsPosix()) {
#endif
    Work();
    Extra();
  }
}
