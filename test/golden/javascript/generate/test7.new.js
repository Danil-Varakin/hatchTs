// [GEN] правка внутри генератора рядом с yield*
export function* walk(node) {
  yield node.value;
  for (const child of node.children) {
    yield* walk(child);
  }
}
