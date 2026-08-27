// [DOWHILE] правка внутри макроса do { ... } while (0)
#define LOG_IF(cond, msg)   \
  do {                      \
    if (cond) {             \
      fprintf(stdout, msg); \
    }                       \
  } while (0)
