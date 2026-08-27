# match rs
    ...
    fn boot() {
    ...
    >>>
        let names = vec!["a", "b", "c"];
    <<<
    ...
    }
    ...
# end
# patch
    let names = vec!["a", "b", "c", "d"];
# end
