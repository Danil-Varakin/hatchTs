# match js
    ...
      static {
    ...
    >>>
        Bus.registry.set('default', new Bus());
    <<<
    ...
# end
# patch
    Bus.registry.set('default', new Bus());
        Bus.registry.set('spare', new Bus());
# end
