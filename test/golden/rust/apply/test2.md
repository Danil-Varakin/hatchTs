# match rust
    ...
        pub fn classify( ... ) -> &'static str {
    ...
            0 => "cold",
    >>>
            n if n < 10 => "warm",
    ...
# end
# patch

            n if n < 3 => "tepid",
# end
