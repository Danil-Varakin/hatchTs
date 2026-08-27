// [SATISFIES] правка объекта под оператором satisfies
const config = {
  retries: 3,
  timeout: 2500,
} satisfies Record<string, number>;
