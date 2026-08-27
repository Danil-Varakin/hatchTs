# match go
    ...
    >>>
    WHERE age > 18 AND (role = 'admin' OR role = 'root')
    <<<
    ...
# end
# patch
    WHERE age >= 21 AND (role = 'admin' OR role = 'root')
# end
