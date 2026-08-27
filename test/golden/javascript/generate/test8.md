# match js
    ...
    >>>
    const toPoint = (x, y) => ({ x, y, kind: 'point' });
    <<<
    ...
# end
# patch
    const toPoint = (x, y) => ({ x, y, kind: 'vector' });
# end
