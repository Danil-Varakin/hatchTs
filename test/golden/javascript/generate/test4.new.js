// [IIFE] правка внутри немедленно вызываемой функции
const registry = (function () {
  const items = new WeakMap();
  return { items };
})();
