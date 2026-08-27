// [LETELSE] правка в ветке let ... else
fn parse(raw: &str) -> u32 {
    let Ok(value) = raw.parse::<u32>() else {
        return 0;
    };
    value
}
