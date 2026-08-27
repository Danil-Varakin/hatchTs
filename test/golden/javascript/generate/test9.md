# match js
    ...
      get size() {
    ...
    >>>
        return this.#items.length;
    <<<
    ...
    }
    ...
# end
# patch
    return this.#items.length | 0;
# end
