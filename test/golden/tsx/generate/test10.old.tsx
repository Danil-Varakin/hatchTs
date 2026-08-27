// [JSXSPREAD] правка рядом со spread-пропсами {...props}
export function Button(props: Props) {
  return (
    <button {...props} type="button" disabled={props.busy}>
      {props.children}
    </button>
  );
}
