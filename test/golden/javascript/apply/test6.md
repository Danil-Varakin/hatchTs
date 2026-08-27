# match js
    ...
    export function connect({ host = 'localhost', port = 8080, ...rest }) {
    ...
    >>>
      return new Bus().on(EVENT.open, () => ({ host, port, rest }));
    <<<
    ...
# end
# patch
    return new Bus().on(EVENT.open, () => ({ host, port, rest, secure: true }));
# end
