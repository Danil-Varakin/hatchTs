# match ts
    ...
    >>>
    export function pick<T extends Record<string, unknown>>(src: T, key: keyof T): T[keyof T] {
    <<<
    ...
# end
# patch
    export function pick<T extends Record<string, never>>(src: T, key: keyof T): T[keyof T] {
# end
