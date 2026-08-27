# match js
    ...
      bump() {
    ...
    >>>
        this.#value += 1;
    <<<
    ...
    }
    ...
# end
# patch
    this.#value += 2;
# end
