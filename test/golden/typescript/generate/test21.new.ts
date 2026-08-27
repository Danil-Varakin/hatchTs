// [OVLDUP] две перегрузки, различие ТОЛЬКО внутри угловых скобок
export function load(input: Reader<Uint8Array | null>): void;
export function load(input: Reader<ArrayBuffer>): void;
export function load(input: unknown): void {
  consume(input);
}
