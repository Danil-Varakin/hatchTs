
export function normalize(raw: string): string {
  return raw.split('\n').map(normalizeLine).join('\n');
}

function normalizeLine(line: string): string {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''; 
  const body = line
    .slice(indent.length)
    .replace(/(\w)\s+(?=\w)/g, '$1\u0000') 
    .replace(/\s+/g, '') 
    .replace(/\u0000/g, ' ');
  return indent + body;
}

