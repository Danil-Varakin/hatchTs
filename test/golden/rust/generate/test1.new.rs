// [LIFETIME] апостроф — ВРЕМЯ ЖИЗНИ, а не открытая строка
pub fn longest<'a>(left: &'a str, right: &'a str) -> &'a str {
    if left.len() > right.len() { right } else { left }
}
