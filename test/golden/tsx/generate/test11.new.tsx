// [JSXTERNARY] правка в ветке многострочного тернарника в разметке
export function State({ loading }: Props) {
  return (
    <div>
      {loading ? (
        <Spinner size="large" />
      ) : (
        <Content />
      )}
    </div>
  );
}
