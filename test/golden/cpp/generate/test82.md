# match cc
    ...
    >>>
    constexpr int64_t kBudget = 1'000'000;
    <<<
    ...
# end
# patch
    constexpr int64_t kBudget = 2'500'000;
# end
