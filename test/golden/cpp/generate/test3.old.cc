// [PP] вставка сразу после #define-гарда (первое значащее в файле — препроцессор)
#ifndef BASE_FOO_H_
#define BASE_FOO_H_

#include <stddef.h>

namespace base {
void Foo();
}

#endif  // BASE_FOO_H_
