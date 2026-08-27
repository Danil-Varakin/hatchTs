// [GENERIC] правка внутри параметра-дженерика <T extends U>
export function pick<T extends Record<string, unknown>>(src: T, key: keyof T): T[keyof T] {
  return src[key];
}
