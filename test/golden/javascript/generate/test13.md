# match js
    ...
      for (const cell of row) {
    ...
    >>>
        emit(cell);
    <<<
    ...
    }
    ...
# end
# patch
    emit(cell, row);
# end
