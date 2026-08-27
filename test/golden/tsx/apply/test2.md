# match tsx
    ...
              {items.map((item) => (
    ...
    >>>
                  <td>{item.title}</td>
    <<<
    ...
# end
# patch
    <td>{item.title.trim()}</td>
# end
