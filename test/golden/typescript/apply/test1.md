# match ts
    ...
    >>>
    export function schedule<T>(queue: Queue<T>, tasks: readonly Task<T>[]): void;
    <<<
    ...
# end
# patch
    export function schedule<T>(queue: Queue<T>, tasks: Iterable<Task<T>>): void;
# end
