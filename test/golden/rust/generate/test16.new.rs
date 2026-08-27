// [CHARLIT] символьный литерал 'a' рядом со ВРЕМЕНЕМ ЖИЗНИ 'a — апострофы разной природы
pub fn split<'a>(text: &'a str) -> Vec<&'a str> {
    text.split('b').filter(|s| !s.is_empty()).collect()
}
