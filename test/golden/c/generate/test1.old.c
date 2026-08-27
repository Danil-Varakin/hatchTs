// [NOTEMPLATE] `<` и `>` в C — только сравнение; парой их считать нельзя
int clamp(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
