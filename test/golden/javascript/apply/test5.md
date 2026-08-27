# match js
    ...
    export const defaults = (function () {
    ...
    >>>
      items.set(EVENT.close, 2);
    <<<
    ...
# end
# patch
    items.set(EVENT.close, 2);
      items.set('error', 3);
# end
