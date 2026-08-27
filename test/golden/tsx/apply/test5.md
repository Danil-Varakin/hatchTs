# match tsx
    ...
      if (loading) {
    ...
    >>>
        return <Spinner size="small" />;
    <<<
    ...
# end
# patch
    return <Spinner size="large" delay={200} />;
# end
