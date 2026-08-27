# match cc
    ...
    >>>
      IPC_MESSAGE_HANDLER(Msg_B, OnB)
    <<<
    ...
# end
# patch
    IPC_MESSAGE_HANDLER(Msg_B, OnBrave)
# end
