# match cc
    ...
    // [DUP] восемь одинаковых #include на верхнем уровне, правка седьмого (родителя нет вовсе)
    #include "same.h"
    #include "same.h"
    #include "same.h"
    #include "same.h"
    #include "same.h"
    #include "same.h"
    >>>
    ...
# end
# patch

    #include "other.h"
# end

# match cc
    ...
    #include "other.h"
    #include "same.h"
    >>>
    #include "same.h"
    ...
    <<<
    void f() {}
    ...
# end
# patch


# end
