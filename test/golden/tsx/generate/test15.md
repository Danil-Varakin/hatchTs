# match tsx
    ...
      return (
    ...
    >>>
                          <a10 value={1} />
    <<<
    ...
    )
    ...
# end
# patch
    <a10 value={42} />
# end
