// [IMPLDUP] два impl одного трейта, различие ТОЛЬКО внутри угловых скобок
impl Handler<Request> for Router {
    fn handle(&self) -> u32 {
        self.count()
    }
}

impl Handler<Response> for Router {
    fn handle(&self) -> u32 {
        self.count()
    }
}
