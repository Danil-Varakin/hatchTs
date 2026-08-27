# match kotlin
    ...
    >>>
        fun describe(setting: Setting) = "${setting.key} = ${setting.value}"
    <<<
    ...
# end
# patch
    fun describe(setting: Setting) = "${setting.key}: ${setting.value}"
# end
