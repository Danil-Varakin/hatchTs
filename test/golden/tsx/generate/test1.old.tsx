// [TSXONLY] дженерик-стрелка с ЗАПЯТОЙ <T,> — в .ts запятая не нужна, в .tsx обязательна
export const identity = <T,>(value: T): T => {
  return value;
};
