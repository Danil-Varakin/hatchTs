# match tsx
    ...
      return (
    ...
    >>>
          <Body rows={rows} />
    <<<
    ...
    )
    ...
# end
# patch
    <Body rows={visibleRows} />
# end
