// [JSXGENERIC] дженерик-параметр У КОМПОНЕНТА внутри JSX
export function Page() {
  return (
    <Select<Option>
      items={options}
      onPick={handlePick}
    />
  );
}
