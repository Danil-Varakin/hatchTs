// [SHIFTASSIGN] `>>>=` в правящейся строке (в js это один токен, для Hatch — точка вставки)
export function scramble(seed) {
  let h = seed;
  h >>>= 11;
  return h;
}
