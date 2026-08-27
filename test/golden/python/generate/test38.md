# match py
    ...
    if TYPE_CHECKING:
    ...
    >>>
        from pkg.models import Edge
    <<<
    ...
    def link(a, b):
    ...
# end
# patch
    from pkg.models import Graph
# end
