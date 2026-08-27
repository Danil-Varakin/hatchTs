// [FENCE] в исходнике raw string с markdown-оградой ``` — она попадёт в .md
const char kDoc[] = R"(
```cpp
int sample = 2;
```
)";

void f() {
  int a = 1;
}
