// [COMPOUND] правка внутри составного литерала (struct S){ ... }
void reset(struct Point *p) {
  *p = (struct Point){ .x = 0, .y = 0, .z = 0 };
}
