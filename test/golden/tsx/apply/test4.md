# match tsx
    ...
    export function Picker<T extends Task>(props: Props<T>) {
    ...
    >>>
          render={(item) => <Badge value={item.title} />}
    <<<
    ...
# end
# patch
    render={(item) => <Badge value={item.title} muted={item.done} />}
# end
