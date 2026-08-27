// [MULTI] правка внутри вложенных шаблонов (обобщение по < > съедает различитель)
void f() {
  std::map<std::string, std::vector<int>> first;
  std::map<std::string, std::vector<int>> second;
  use(first, second);
}
