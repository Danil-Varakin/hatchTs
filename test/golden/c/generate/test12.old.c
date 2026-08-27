// [DOWHILE] правка внутри макроса do { ... } while (0)
#define LOG_IF(cond, msg)   \
  do {                      \
    if (cond) {             \
      fprintf(stderr, msg); \
    }                       \
  } while (0)
