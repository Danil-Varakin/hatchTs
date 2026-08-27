# match js
    ...
      get size() {
    ...
    >>>
        return this.#handlers.size;
    <<<
    ...
# end
# patch
    return this.#handlers.size | 0;
# end
