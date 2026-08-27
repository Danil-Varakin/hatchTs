# match ts
    ...
    export interface Queue<T> {
      push(task: Task<T>): void;
    >>>
      pop(): Task<T> | undefined;
    ...
# end
# patch

      peek(): Task<T> | undefined;
# end
