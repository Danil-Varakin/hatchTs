# match ts
    ...
    >>>
    type Route = `/${string}/${'get' | 'put'}`;
    <<<
    ...
# end
# patch
    type Route = `/${string}/${'get' | 'put' | 'del'}`;
# end
