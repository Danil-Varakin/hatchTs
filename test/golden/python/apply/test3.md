Удаление строки: тело патча пустое, диапазон захватывает строку целиком.

# match python
    ...
    class Queue:
    ...
            if self.size() >= self.limit:
    >>>
    ...
                log.warning("очередь переполнена")
    <<<
    ...
                return False
    ...
# end
# patch
# end
