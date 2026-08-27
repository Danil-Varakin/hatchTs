# match ts
    ...
    constructor(
    ...
    >>>
        private readonly handler: Handler<T>,
    <<<
    ...
# end
# patch
    private readonly handler: Handler<T>,
        private readonly clock: Clock,
# end
