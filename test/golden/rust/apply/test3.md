# match rust
    ...
    impl<'a> fmt::Display for Entry<'a> {
    ...
    >>>
            write!(f, "{} ({} hits)", self.key, self.hits)
    <<<
    ...
# end
# patch
    write!(f, "{} [{} hits]", self.key, self.hits)
# end
