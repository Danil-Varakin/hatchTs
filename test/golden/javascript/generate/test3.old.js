// [REGEX] скобки внутри регулярки — не структура
const OPEN = /\(\{\[/g;
function strip(text) {
  return text.replace(OPEN, '');
}
