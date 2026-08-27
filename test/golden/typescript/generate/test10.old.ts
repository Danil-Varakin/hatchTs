// [ASSERT] правка в цепочке утверждений as unknown as T
const raw: unknown = load();
const typed = raw as unknown as Record<string, number>;
export const total = typed.count as number;
