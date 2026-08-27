Правка в середине цепочки if/elif: `i += 1` встречается в двух ветках, различает
только строка самой ветки.

# match python
    ...
    def parse(argv):
    ...
            elif arg == "--level":
    ...
    >>>
                opts["level"] = int(argv[i])
    <<<
    ...
# end
# patch
    opts["level"] = max(0, int(argv[i]))
# end
