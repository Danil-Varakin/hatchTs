# match java
    ...
    >>>
            WHERE active = 1
    <<<
    ...
# end
# patch
    WHERE active = 1 AND banned = 0
# end
