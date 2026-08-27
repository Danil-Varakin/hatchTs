// [MULTI] правка внутри вложенных шаблонов (обобщение по < > съедает различитель)
void f() {
  std::map<std::string, std::vector<int>> first;
  std::map<std::string, std::vector<long>> second;
  use(first, second);
}
