# match js
    ...
    catch {
    ...
    >>>
        return null;
    <<<
    ...
    }
    ...
# end
# patch
    return undefined;
# end
