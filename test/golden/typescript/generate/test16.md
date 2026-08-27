# match ts
    ...
    >>>
    export class Bag<T extends object = Record<string, never>> {
    <<<
    ...
# end
# patch
    export class Bag<T extends object = Record<string, unknown>> {
# end
