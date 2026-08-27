// [ABSTRACT] правка в абстрактном члене между двумя обычными
export abstract class Codec implements Named {
  readonly name = 'codec';
  abstract encode(input: string, level?: number): Uint8Array;
  decode(bytes: Uint8Array): string {
    return String(bytes);
  }
}
