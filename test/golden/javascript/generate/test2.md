# match js
    ...
    >>>
    const render = (user) => `hello, ${user.name.trim()} (${user.roles.join(', ')})`;
    <<<
    ...
# end
# patch
    const render = (user) => `hello, ${user.name.trim()} (${user.roles.join(' | ')})`;
# end
