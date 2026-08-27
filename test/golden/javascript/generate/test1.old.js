// [LT] `<` и `>` — ТОЛЬКО операторы, парой их считать нельзя (в отличие от ts)
function between(a, b, c) {
  if (a < b && c > a) {
    return b;
  }
  return c;
}
