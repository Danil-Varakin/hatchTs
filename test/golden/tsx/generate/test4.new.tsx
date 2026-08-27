// [JSXEXPR] правка внутри выражения {cond && <div/>} в разметке
export function Banner({ visible, text }: Props) {
  return (
    <div>
      {visible && <strong>{text.trim()}</strong>}
    </div>
  );
}
