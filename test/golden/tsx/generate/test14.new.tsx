// [PANELDUP] две одинаковые панели, различитель — только значение атрибута
export function Split() {
  return (
    <>
      <Panel title="left">
        <Body rows={visible} dense />
      </Panel>
      <Panel title="right">
        <Body rows={rows} dense />
      </Panel>
    </>
  );
}
