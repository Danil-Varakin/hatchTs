// [TEMPLATE] правка внутри строкового шаблона со сложным ${...}
fun describe(u: User) = "user $u.id: ${u.name.uppercase()} (${u.roles.size})"
