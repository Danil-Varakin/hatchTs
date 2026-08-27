// [DEFAULT] правка дефолта параметра-дженерика <T = {}>
export class Bag<T extends object = Record<string, never>> {
  private items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
}
