# match tsx
    ...
    function Icon() {
    ...
    >>>
      return <img src={url} alt="" />;
    <<<
    ...
    }
    ...
# end
# patch
    return <picture src={url} alt=""><img src={url} /></picture>;
# end
