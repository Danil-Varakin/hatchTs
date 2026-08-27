// [IFACE] правка метода В СЕРЕДИНЕ интерфейса
export interface Store {
  get(key: string): string | undefined;
  set(key: string, value: string, ttl?: number): void;
  delete(key: string): boolean;
}
