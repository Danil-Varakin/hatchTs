# match java
    ...
    >>>
            .map(User::getName)
    <<<
    ...
# end
# patch
    .map(User::getDisplayName)
# end
