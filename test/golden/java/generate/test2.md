# match java
    ...
        @Override
        public void run() {
    ...
    >>>
            service.refresh();
    <<<
    ...
    }
    ...
# end
# patch
    service.refreshAll();
# end
