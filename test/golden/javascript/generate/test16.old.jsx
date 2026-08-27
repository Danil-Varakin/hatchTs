// [JSX] JSX в .jsx — грамматика javascript разбирает его сама
export function Row({ item }) {
  return (
    <li className="row">
      <span>{item.label}</span>
    </li>
  );
}
