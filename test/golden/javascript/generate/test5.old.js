// [DESTR] правка дефолта в деструктуризации с остатком
export function connect({ host = 'localhost', port = 8080, ...rest }) {
  return { host, port, rest };
}
