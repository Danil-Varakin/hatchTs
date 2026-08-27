// [MATCH] правка в руке match с гардом и альтернативами через |
fn kind(n: i32) -> &'static str {
    match n {
        0 => "zero",
        x if x < 0 => "negative",
        1 | 2 | 3 | 5 => "small",
        _ => "large",
    }
}
