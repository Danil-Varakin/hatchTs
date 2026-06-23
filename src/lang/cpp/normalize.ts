export function normalize(raw: string): string {
  return raw
    .replace(/(\w)\s+(?=\w)/g, '$1\u0000') 
    .replace(/\s+/g, '') 
    .replace(/\u0000/g, ' '); 
}