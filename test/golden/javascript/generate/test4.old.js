// [IIFE] правка внутри немедленно вызываемой функции
const registry = (function () {
  const items = new Map();
  return { items };
})();
