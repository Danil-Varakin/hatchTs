"""Разбор аргументов командной строки."""

import sys


def parse(argv):
    opts = {"verbose": False, "out": None, "level": 0}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--verbose":
            opts["verbose"] = True
        elif arg == "--out":
            i += 1
            opts["out"] = argv[i]
        elif arg == "--level":
            i += 1
            opts["level"] = max(0, int(argv[i]))
        elif arg == "--help":
            usage()
            return None
        else:
            raise SystemExit("неизвестный аргумент: " + arg)
        i += 1
    return opts


def usage():
    print("использование: tool [--verbose] [--out FILE] [--level N]")


def main(argv):
    opts = parse(argv)
    if opts is None:
        return 0
    if opts["verbose"]:
        print("режим подробного вывода")
    if opts["out"] is None:
        print("вывод в stdout")
    else:
        print("вывод в " + opts["out"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
