# match py
    ...
    >>>
    def build(opts={"retry": 3, "delay": 5}):
    <<<
    ...
# end
# patch
    def build(opts={"retry": 3, "delay": 10}):
# end
