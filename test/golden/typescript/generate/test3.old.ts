// [CONDTYPE] правка в ветке условного типа T extends U ? X : Y
type Unwrap<T> = T extends Promise<infer R>
  ? R
  : T extends Array<infer E>
    ? E
    : never;
