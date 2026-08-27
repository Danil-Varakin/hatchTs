# match kt
    ...
    >>>
    fun describe(u: User) = "user $u.id: ${u.name.uppercase()} (${u.roles.size})"
    <<<
    ...
# end
# patch
    fun describe(u: User) = "user $u.id: ${u.name.lowercase()} (${u.roles.size})"
# end
