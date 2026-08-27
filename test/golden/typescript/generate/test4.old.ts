// [TYPE] правка внутри mapped type { [K in keyof T]: ... }
type Boxed<T> = {
  [K in keyof T]: { value: T[K]; dirty: boolean };
};
