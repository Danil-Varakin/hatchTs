// [PP] правка в ОДНОЙ из двух веток #if/#else с ОДИНАКОВЫМ телом
void Init() {
#if BUILDFLAG(IS_WIN)
  Setup();
  Run();
#else
  Setup();
  Run();
#endif
}
