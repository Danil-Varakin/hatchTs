// [FORAWAIT] правка внутри for await
export async function drain(stream) {
  for await (const chunk of stream) {
    process(chunk, true);
  }
}
