# match javascript
    ...
    handlers = {
    ...
    >>>
      [EVENT.close]: onClose,
    <<<
    ...
    }
    ...
# end
# patch
    [EVENT.close]: onShutdown,
# end
