# match js
    ...
      static {
    ...
    >>>
        Registry.map.set('default', 1);
    <<<
    ...
    }
    ...
# end
# patch
    Registry.map.set('default', 42);
# end
