# match rs
    ...
    fn compile() -> Regex {
    ...
    >>>
        Regex::new(PATTERN).unwrap()
    <<<
    ...
    }
    ...
# end
# patch
    Regex::new(PATTERN).expect("bad pattern")
# end
