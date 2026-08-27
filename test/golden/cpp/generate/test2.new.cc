// [PP] вставка #include внутрь блока #if BUILDFLAG(...)
#include "base/a.h"

#if BUILDFLAG(ENABLE_X)
#include "x/one.h"
#include "x/two.h"
#endif

#if BUILDFLAG(ENABLE_Y)
#include "y/one.h"
#endif
