# match cc
    ...
    void f() {
    ...
    >>>
      std::map<std::string, std::vector<int>> second;
    <<<
    ...
    }
    ...
# end
# patch
    std::map<std::string, std::vector<long>> second;
# end
