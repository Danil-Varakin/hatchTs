// [BRACE] raw string literal со скобками и переводами строк
const char kJson[] = R"({
  "a": { "b": 1 }
})";

void Use() {
  Parse(kJson);
}
