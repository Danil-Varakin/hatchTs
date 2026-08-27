// [TEMPLATE] правка внутри строкового шаблона со сложным ${...}
fun describe(u: User) = "user $u.id: ${u.name.lowercase()} (${u.roles.size})"
