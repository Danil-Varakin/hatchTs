# match rust
    ...
    where
        I: IntoIterator<Item = u64>,
    ...
    >>>
        items.into_iter().map(|n| n.to_string()).collect()
    <<<
    ...
# end
# patch
    items.into_iter().map(|n| format!("{n:04}")).collect()
# end
