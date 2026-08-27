// [PP] правка внутри многострочного #define с продолжениями \
#define DEBUG_ALIAS_FOR_CSTR(var_name, c_str, char_count)  \
    char var_name[char_count + 1];                             \
    ::base::debug::Alias(var_name)

void Use() {
  DEBUG_ALIAS_FOR_CSTR(x, "y", 8);
}
