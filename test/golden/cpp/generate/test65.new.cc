// [FENCE] ограда ``` попадает В ТЕЛО ПАТЧА (добавляем новый пример в raw string)
const char kDoc[] = R"(
intro
```cpp
int sample = 1;
```
)";

void f() { work(); }
