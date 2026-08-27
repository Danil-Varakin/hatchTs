// [TUPLE] правка в именованном кортеже с опциональным элементом
type Span = [start: number, end: number, label?: string];
export function width([start, end]: Span): number {
  return end - start;
}
