// [JSXCOMMENT] комментарий {/* ... */} внутри разметки рядом с правкой
export function Panel() {
  return (
    <section>
      {/* заголовок рисуется отдельно */}
      <Body rows={visibleRows} />
    </section>
  );
}
