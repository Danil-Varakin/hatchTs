# match py
    ...
    >>>
    def quick(): a = 1; b = 2; c = 3; return a + b + c
    <<<
    ...
# end
# patch
    def quick(): a = 1; b = 20; c = 3; return a + b + c
# end
