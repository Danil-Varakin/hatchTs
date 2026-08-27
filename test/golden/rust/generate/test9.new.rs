// [MOD] правка во ВЛОЖЕННОМ модуле mod a { mod b { } }
mod net {
    pub mod http {
        pub const PORT: u16 = 8080;
    }
}
