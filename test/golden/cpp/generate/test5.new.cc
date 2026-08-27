// [PP] правка на третьем уровне вложенных #if (вложенность есть, но не скобочная)
#if BUILDFLAG(IS_POSIX)
#if BUILDFLAG(IS_MAC)
#if defined(ARCH_CPU_ARM64)
  const int kValue = 2;
#endif
#endif
#endif
