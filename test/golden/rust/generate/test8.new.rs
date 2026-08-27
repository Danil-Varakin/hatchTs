// [HASHSTR] правка рядом с сырой строкой r#"…"# со скобками внутри
const PATTERN: &str = r#"\{(?P<name>[^}]+)\}"#;

fn compile() -> Regex {
    Regex::new(PATTERN).expect("bad pattern")
}
