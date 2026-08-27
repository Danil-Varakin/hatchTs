// [GEN] правка внутри генератора рядом с yield*
export function* walk(node) {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}
