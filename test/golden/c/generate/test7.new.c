// [ANONUNION] правка внутри анонимного union внутри struct
struct Value {
  int tag;
  union {
    long i;
    double d[2];
  };
};
