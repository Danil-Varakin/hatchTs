// [JSXMAP] правка внутри .map, порождающего разметку
export function Menu({ items }: Props) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.caption}</li>
      ))}
    </ul>
  );
}
