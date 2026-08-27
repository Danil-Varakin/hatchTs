# match ts
    ...
    >>>
    type Span = [start: number, end: number, label?: string];
    <<<
    ...
# end
# patch
    type Span = [start: number, end: number, label?: string, weight?: number];
# end
