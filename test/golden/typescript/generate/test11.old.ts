// [OPT] правка в цепочке ?. и ! (постфиксные, не скобки)
export function depth(node?: Tree): number {
  return node?.left!.right?.depth ?? 0;
}
