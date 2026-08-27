// [OVERLOAD] три сигнатуры-перегрузки без тела, правка СРЕДНЕЙ
export function read(src: string): string;
export function read(src: Buffer, enc?: string): string;
export function read(src: URL): string;
export function read(src: unknown): string {
  return String(src);
}
