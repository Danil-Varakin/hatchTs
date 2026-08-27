// [GENERIC] правка во ВНУТРЕННЕМ дженерике вложенной аннотации
const cache: Map<string, Array<Promise<bigint>>> = new Map();
export function put(k: string, v: Array<Promise<number>>): void {
  cache.set(k, v);
}
