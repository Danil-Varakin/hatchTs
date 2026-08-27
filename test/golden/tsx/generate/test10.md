# match tsx
    ...
      return (
    ...
    >>>
        <button {...props} type="button" disabled={props.busy}>
    <<<
    ...
    )
    ...
# end
# patch
    <button {...props} type="button" disabled={props.busy || props.locked}>
# end
