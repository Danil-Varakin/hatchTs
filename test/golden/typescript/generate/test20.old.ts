// [SHIFT] беззнаковый сдвиг `>>>` в теле стрелки
export const bucket = (hash: number): number => hash >>> 24;
export const slot = (hash: number): number => hash & 0xff;
