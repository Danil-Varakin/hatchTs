// [TEMPLITVAL] правка внутри ${} шаблонного литерала с вызовом
const render = (user) => `hello, ${user.name.trim()} (${user.roles.join(', ')})`;
