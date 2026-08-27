// [C11GENERIC] правка ветки _Generic (селектор типа, не дженерик)
#define size_of(x) _Generic((x), \
    int: sizeof(int),            \
    long: sizeof(long long),     \
    default: 0)
