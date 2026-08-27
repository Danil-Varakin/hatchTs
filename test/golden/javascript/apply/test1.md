# match js
    ...
    export class Bus {
    ...
      #handlers = new Map();
    >>>
      #depth = 0;
    ...
# end
# patch

      #closed = false;
# end
