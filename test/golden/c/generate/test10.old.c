// [FNPTR] правка сигнатуры указателя на функцию в typedef
typedef int (*compare_fn)(const void *a, const void *b);

void sort_all(void *base, size_t n, compare_fn cmp) {
  qsort(base, n, sizeof(void *), cmp);
}
