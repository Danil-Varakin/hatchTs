// [WHENDUP] две ветки when, различитель — только строка ВНУТРИ скобок предиката
fun route(cmd: Cmd): Int = when {
    matches(cmd, "push") -> handle(cmd.payload, retries(3))
    matches(cmd, "pull") -> handle(cmd.payload, retries(1))
    else -> 0
}
