# match kt
    ...
    >>>
    fun perimeter(w: Int, h: Int) = 2 * (w + h)
    <<<
    ...
# end
# patch
    fun perimeter(w: Int, h: Int) = 2 * (w + h) + 1
# end
