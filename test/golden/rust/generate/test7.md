# match rs
    ...
    >>>
    #[derive(Debug, Clone, PartialEq)]
    <<<
    ...
# end
# patch
    #[derive(Debug, Clone, PartialEq, Eq, Hash)]
# end
