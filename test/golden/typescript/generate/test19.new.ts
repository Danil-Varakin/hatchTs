// [ANGLES] `>>>` из тройного закрытия дженериков в аннотации типа
const index: Map<string, Array<Set<bigint>>> = new Map();

export function put(key: string, value: Set<number>): void {
  index.get(key)?.push(value);
}
