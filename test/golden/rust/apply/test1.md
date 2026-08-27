# match rust
    ...
    pub trait Backend {
    ...
        fn describe(&self) -> String {
    ...
    >>>
            format!("backend with {} keys", self.len())
    <<<
    ...
# end
# patch
    format!("backend holding {} keys", self.len())
# end
