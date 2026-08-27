// [JSXPROP] JSX внутри пропа-функции (разметка в аргументе)
export function List() {
  return (
    <Table
      render={(row) => <Cell value={row.total} />}
      empty={<Placeholder />}
    />
  );
}
