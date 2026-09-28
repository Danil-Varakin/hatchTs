# match python
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
