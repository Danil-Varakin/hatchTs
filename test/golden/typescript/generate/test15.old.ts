// [SATISFIES] правка объекта под оператором satisfies
const config = {
  retries: 3,
  timeout: 1000,
} satisfies Record<string, number>;
