# match ts
    ...
    abstract class Codec implements Named {
    ...
    >>>
      abstract encode(input: string): Uint8Array;
    <<<
    ...
    }
    ...
# end
# patch
    abstract encode(input: string, level?: number): Uint8Array;
# end
