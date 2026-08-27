# match cc
    ...
    // [BRACE] функция обёрнута в новый #if — правка ДОБАВЛЯЕТ несбалансированный препроцессор
    >>>
    ...
# end
# patch

    #if BUILDFLAG(IS_WIN)
# end

# match cc
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
