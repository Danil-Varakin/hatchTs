# match js
    ...
      *entries() {
    ...
    >>>
          yield [name, list.length];
    <<<
    ...
# end
# patch
    yield [name, list.length, this.#depth];
# end
