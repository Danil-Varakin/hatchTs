// [STATIC] правка внутри статического блока класса
class Registry {
  static map = new Map();
  static {
    Registry.map.set('default', 42);
  }
}
