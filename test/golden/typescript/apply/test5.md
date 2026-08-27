# match ts
    ...
    export namespace metrics {
    ...
      export function empty(): Snapshot {
    ...
    >>>
        return { pending: 0, done: 0 };
    <<<
    ...
# end
# patch
    return { pending: 0, done: 0, failed: 0 };
# end
