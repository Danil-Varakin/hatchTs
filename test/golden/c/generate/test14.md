# match c
    ...
    >>>
        if (a > b) <% return a; %>
    <<<
    ...
# end
# patch
    if (a > b) <% return a + 1; %>
# end
