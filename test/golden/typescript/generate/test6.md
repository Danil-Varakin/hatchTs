# match ts
    ...
    interface Store {
    ...
    >>>
      set(key: string, value: string): void;
    <<<
    ...
    }
    ...
# end
# patch
    set(key: string, value: string, ttl?: number): void;
# end
