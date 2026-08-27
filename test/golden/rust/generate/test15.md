# match rs
    ...
    >>>
    pub fn grid() -> Vec<Vec<Vec<u8>>> {
    <<<
    ...
# end
# patch
    pub fn grid() -> Vec<Vec<Vec<u16>>> {
# end
