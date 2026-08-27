// [TURBOFISH] правка внутри турбофиша ::<T>
fn ids(raw: &str) -> Vec<u32> {
    raw.split(',').map(str::parse::<u32>).flatten().collect::<Vec<_>>()
}
