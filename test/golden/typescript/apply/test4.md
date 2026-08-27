# match ts
    ...
    export class Worker<T> {
    ...
      stop(): void {
    ...
    >>>
        this.running = false;
    <<<
    ...
# end
# patch
    this.running = false;
        this.log.info('worker stopped');
# end
