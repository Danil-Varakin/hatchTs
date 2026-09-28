# match cpp
    ...
    // [BRACE] функция обёрнута в новый #if — правка ДОБАВЛЯЕТ несбалансированный препроцессор
    >>>
    ...
# end
# patch

    #if BUILDFLAG(IS_WIN)
# end

# match cpp
    ...
    >>>
# end
# patch
    #else
    void f() {
      other();
    }
    #endif

# end
