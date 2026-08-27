# match tsx
    ...
      return (
    ...
    >>>
          {visible && <strong>{text}</strong>}
    <<<
    ...
    )
    ...
# end
# patch
    {visible && <strong>{text.trim()}</strong>}
# end
