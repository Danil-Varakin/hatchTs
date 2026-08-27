// [MACRODUP] два вызова макроса, различитель — только аргументы ВНУТРИ скобок
static void setup(void) {
  REGISTER(handler_a, "alpha", 1);
  REGISTER(handler_b, "beta", 1);
}
