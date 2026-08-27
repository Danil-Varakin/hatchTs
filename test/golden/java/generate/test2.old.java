// [ANONCLASS] правка в теле анонимного класса new Foo() { ... }
executor.submit(new Runnable() {
    @Override
    public void run() {
        service.refresh();
    }
});
