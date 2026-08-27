// [BRACE] raw string literal со скобками и переводами строк
const char kJson[] = R"({
  "a": { "b": 2 }
})";

void Use() {
  Parse(kJson);
}
