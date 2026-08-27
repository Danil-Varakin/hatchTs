# match tsx
    ...
    >>>
          {items.length === 0 && <Empty hint="nothing here" />}
    <<<
    ...
# end
# patch
    {items.length === 0 && <Empty hint="no tasks yet" />}
# end
