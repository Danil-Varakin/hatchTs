// [FOLD] fold-выражение C++17: `...` стоит ОТДЕЛЬНЫМ СЛОВОМ в правящейся строке
template <typename... Args>
int sum_all(Args... values) {
  return ( ... + values );
}
