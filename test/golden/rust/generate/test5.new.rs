// [CLOSURE] вертикальные черты замыкания — не скобки
fn totals(rows: &[Row]) -> Vec<u64> {
    rows.iter()
        .map(|row| row.width * row.height * 2)
        .collect()
}
