# match rust
    ...
    #[derive(Debug, Clone, PartialEq)]
    >>>
    pub struct Entry<'a> {
    <<<
    ...
# end
# patch
    pub struct Entry<'a, T = ()> {
# end
