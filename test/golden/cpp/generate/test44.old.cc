// [ERROR] макросы открывают и закрывают блок — в тексте баланса нет
#define BEGIN_MAP() switch (id) {
#define END_MAP() }

void f(int id) {
  BEGIN_MAP()
    case 1: a(); break;
    case 2: b(); break;
  END_MAP()
}
