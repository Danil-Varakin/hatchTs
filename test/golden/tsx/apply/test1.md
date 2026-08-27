# match tsx
    ...
    export function Toolbar() {
    ...
          <button type="button">refresh</button>
    >>>
          <button type="button">clear</button>
    ...
# end
# patch

          <button type="button">export</button>
# end
