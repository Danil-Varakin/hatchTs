# match py
    ...
    	for row in rows:
    ...
    >>>
                check(row)
    <<<
    ...
    return rows
    ...
# end
# patch
    check(row, deep=True)
# end
