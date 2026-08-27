# match tsx
    ...
      return (
    ...
    >>>
          render={(row) => <Cell value={row.value} />}
    <<<
    ...
    )
    ...
# end
# patch
    render={(row) => <Cell value={row.total} />}
# end
