# match py
    ...
        else:
    ...
    >>>
            data = data.strip()
    <<<
    ...
    finally:
    ...
# end
# patch
    data = data.rstrip()
# end
