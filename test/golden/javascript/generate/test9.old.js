// [ACCESSOR] правка в геттере между двумя другими членами
class Box {
  #items = [];
  get size() {
    return this.#items.length;
  }
  set size(n) {
    this.#items.length = n;
  }
}
