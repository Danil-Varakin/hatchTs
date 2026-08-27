// [DESTR] правка дефолта в деструктуризации с остатком
export function connect({ host = 'localhost', port = 9090, ...rest }) {
  return { host, port, rest };
}
