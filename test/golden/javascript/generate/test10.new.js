// [PRIVATE] правка приватного поля с решёткой (# — не комментарий)
class Counter {
  #value = 0;
  bump() {
    this.#value += 2;
    return this.#value;
  }
}
