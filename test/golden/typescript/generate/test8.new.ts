// [CLASSDECOR] правка аргумента декоратора над методом класса
class Api {
  @route({ path: '/users', method: 'POST' })
  list(): string[] {
    return [];
  }
}
