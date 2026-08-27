// [CLASSDECOR] правка аргумента декоратора над методом класса
class Api {
  @route({ path: '/users', method: 'GET' })
  list(): string[] {
    return [];
  }
}
