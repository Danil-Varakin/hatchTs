// [CATCH] правка в catch без привязки ошибки
export function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
