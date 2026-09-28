# match javascript
    ...
    function () {
    ...
    >>>
      const items = new Map();
    <<<
    ...
    }
    ...
# end
# patch
    const items = new WeakMap();
# end
