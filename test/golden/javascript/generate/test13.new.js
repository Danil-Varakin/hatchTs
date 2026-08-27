// [LABEL] правка внутри помеченного цикла с continue label
outer: for (const row of rows) {
  for (const cell of row) {
    if (!cell) continue outer;
    emit(cell, row);
  }
}
