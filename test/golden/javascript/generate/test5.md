# match js
    ...
    >>>
    export function connect({ host = 'localhost', port = 8080, ...rest }) {
    <<<
    ...
# end
# patch
    export function connect({ host = 'localhost', port = 9090, ...rest }) {
# end
