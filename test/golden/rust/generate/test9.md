# match rs
    ...
        pub mod http {
    ...
    >>>
            pub const PORT: u16 = 80;
    <<<
    ...
    }
    ...
# end
# patch
    pub const PORT: u16 = 8080;
# end
