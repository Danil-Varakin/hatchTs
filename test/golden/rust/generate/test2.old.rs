// [IMPL] правка метода внутри impl Trait for Type
impl fmt::Display for Ticket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ticket #{}", self.id)
    }
}
