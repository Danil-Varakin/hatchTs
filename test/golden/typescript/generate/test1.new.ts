// [GENERIC] правка внутри параметра-дженерика <T extends U>
export function pick<T extends Record<string, never>>(src: T, key: keyof T): T[keyof T] {
  return src[key];
}
