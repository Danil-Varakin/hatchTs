# match javascript
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
