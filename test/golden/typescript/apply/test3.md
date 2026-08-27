# match ts
    ...
    export enum Priority {
    ...
    >>>
      Normal = 10,
    <<<
    ...
# end
# patch
    Normal = 15,
# end
