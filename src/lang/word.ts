const WORD = /[\p{L}\p{N}_]/u;

export function isWordChar(ch: string): boolean {
  return WORD.test(ch);
}
