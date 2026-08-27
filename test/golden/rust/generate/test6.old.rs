// [WHERE] правка в многострочной where-клаузе
fn dump<T, W>(value: T, out: &mut W)
where
    T: fmt::Debug + Clone,
    W: io::Write,
{
    writeln!(out, "{:?}", value).unwrap();
}
