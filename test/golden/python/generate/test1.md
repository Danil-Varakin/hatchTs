# match py
    ...
                for bit in cell:
    ...
    >>>
                    emit(bit)
    <<<
    ...
# end
# patch
    emit(bit, strict=True)
# end
