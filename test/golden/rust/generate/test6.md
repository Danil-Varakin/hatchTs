# match rs
    ...
    >>>
        T: fmt::Debug + Clone,
    <<<
    ...
# end
# patch
    T: fmt::Debug + Clone + Send,
# end
